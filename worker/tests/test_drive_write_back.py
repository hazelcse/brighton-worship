"""Writing songsheets to Google Drive, and duplicate songsheets in Drive (Drive and the db are faked)."""

from worship_worker import drive_sync


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload, self.filters = db, table, "select", None, {}

    def select(self, *_): return self
    def order(self, *_, **__): return self
    def limit(self, *_): return self
    def single(self): return self
    def in_(self, k, vs): self.filters["@" + k] = set(vs); return self
    def insert(self, p): self.op, self.payload = "insert", p; return self

    @property
    def not_(self):
        q = self

        class Not:
            def is_(self, k, _v): q.filters["?" + k] = True; return q
        return Not()
    def eq(self, k, v): self.filters[k] = v; return self
    def neq(self, k, v): self.filters["!" + k] = v; return self
    def update(self, p): self.op, self.payload = "update", p; return self
    def upsert(self, p): self.op, self.payload = "upsert", p; return self

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "upsert":
            rows[:] = [r for r in rows if r["drive_file_id"] != self.payload["drive_file_id"]] + [dict(self.payload)]
        if self.op == "insert":
            rows.append(dict(self.payload))
            return type("R", (), {"data": [self.payload]})()

        def ok(r, k, v):
            if k[0] == "!": return r.get(k[1:]) != v
            if k[0] == "@": return r.get(k[1:]) in v
            if k[0] == "?": return r.get(k[1:]) is not None
            return r.get(k) == v
        match = [r for r in rows if all(ok(r, k, v) for k, v in self.filters.items())]
        if self.op == "update":
            for r in match:
                r.update(self.payload)
        return type("R", (), {"data": match})()


class DB:
    def __init__(self, **tables): self.tables = tables
    def table(self, name): return Query(self, name)


class Drive:
    def __init__(self): self.calls = []
    def files(self): return self

    def create(self, body, **_):
        self.calls.append(("create", body))
        return self._result({"id": "new-id", "name": body["name"], "mimeType": body["mimeType"]})

    def update(self, fileId, body=None, **_):
        self.calls.append(("update", fileId, body))
        return self._result({"id": fileId, "name": "Old name.docx", "mimeType": drive_sync.DOCX_MIME})

    def _result(self, f):
        return type("X", (), {"execute": lambda _self: {**f, "md5Checksum": "abc", "modifiedTime": "2026-11-27T00:00:00Z"}})()


def setup(monkeypatch, drive):
    monkeypatch.setenv("DRIVE_FOLDER_ID", "folder")
    monkeypatch.setattr(drive_sync, "configured", lambda: True)
    monkeypatch.setattr(drive_sync, "_drive", lambda: drive)


def test_song_without_a_drive_file_gets_a_new_one(monkeypatch):
    drive = Drive()
    setup(monkeypatch, drive)
    db = DB(drive_files=[], songs=[{"id": "s1", "missing_from_drive_at": "2026-11-01"}])
    out = drive_sync.write_back(db, "s1", b"docx", "Been So Good (C) 73.5.docx")
    assert out["status"] == "added"
    assert drive.calls == [("create", {"name": "Been So Good (C) 73.5.docx", "parents": ["folder"], "mimeType": drive_sync.DOCX_MIME})]
    rec = db.tables["drive_files"][0]
    assert (rec["drive_file_id"], rec["song_id"], rec["status"], rec["fingerprint"]) == ("new-id", "s1", "synced", "abc")
    assert db.tables["songs"][0]["missing_from_drive_at"] is None


def test_song_with_a_drive_file_overwrites_it(monkeypatch):
    drive = Drive()
    setup(monkeypatch, drive)
    db = DB(drive_files=[{"drive_file_id": "d1", "song_id": "s1", "status": "synced", "name": "Old name.docx"}], songs=[])
    out = drive_sync.write_back(db, "s1", b"docx", "whatever.docx")
    assert out["status"] == "updated"
    assert drive.calls == [("update", "d1", None)]
    assert len(db.tables["drive_files"]) == 1 and db.tables["drive_files"][0]["fingerprint"] == "abc"


def test_my_drive_quota_error_is_explained(monkeypatch):
    class Full(Drive):
        def create(self, body, **_): raise RuntimeError("storageQuotaExceeded: Service Accounts do not have storage quota.")
    setup(monkeypatch, Full())
    out = drive_sync.write_back(DB(drive_files=[], songs=[]), "s1", b"docx", "x.docx")
    assert out["status"] == "failed" and "shared drive" in out["message"]


def test_new_drive_file_for_a_song_already_in_drive_is_a_duplicate(monkeypatch):
    db = DB(drive_files=[{"drive_file_id": "d1", "song_id": "s1", "status": "synced"}])
    monkeypatch.setattr(drive_sync.ingest, "create_version", lambda *a: ("v2", False))
    monkeypatch.setattr(drive_sync.ingest, "process_version",
                        lambda *a, **k: {"status": "exists", "song_id": "s1", "title": "Been So Good"})
    out = drive_sync._import(db, "Been So Good.docx", b"x", None, None, "d2", {"d1", "d2"})
    assert out["status"] == "duplicate" and out["song_id"] == "s1"


def test_a_song_whose_old_file_left_the_folder_is_replaced_not_duplicated(monkeypatch):
    db = DB(drive_files=[{"drive_file_id": "d1", "song_id": "s1", "status": "synced"}])
    monkeypatch.setattr(drive_sync.ingest, "create_version", lambda *a: ("v2", False))
    calls = []

    def process(db, vid, song_id, **k):
        calls.append(song_id)
        return {"status": "exists", "song_id": "s1"} if song_id is None else {"status": "done", "song_id": "s1"}
    monkeypatch.setattr(drive_sync.ingest, "process_version", process)
    out = drive_sync._import(db, "Been So Good.docx", b"x", None, None, "d2", {"d2"})  # d1 was deleted in Drive
    assert out["status"] == "replaced" and calls == [None, "s1"]


def test_duplicate_flag_is_raised_once_and_cleared(monkeypatch):
    db = DB(
        drive_files=[{"drive_file_id": "d1", "song_id": "s1", "status": "synced", "name": "A.docx"},
                     {"drive_file_id": "d2", "song_id": "s1", "status": "synced", "name": "B.docx"}],
        songs=[{"id": "s1", "title": "Been So Good", "duplicate_drive_at": None}], song_events=[])
    drive_sync.update_duplicate_flags(db)
    drive_sync.update_duplicate_flags(db)
    assert db.tables["songs"][0]["duplicate_drive_at"]
    assert [(e["kind"], e["details"]["files"]) for e in db.tables["song_events"]] == [("songsheet_duplicate", ["A.docx", "B.docx"])]
    db.tables["drive_files"][1]["status"] = "removed"
    drive_sync.update_duplicate_flags(db)
    assert db.tables["songs"][0]["duplicate_drive_at"] is None


def test_keep_one_bins_the_others(monkeypatch):
    class D(Drive):
        def get(self, fileId, **_):
            return self._result({"id": fileId, "name": f"{fileId}.docx", "mimeType": drive_sync.DOCX_MIME})
    drive = D()
    setup(monkeypatch, drive)
    monkeypatch.setattr(drive_sync, "_download", lambda _d, f: (f["name"], b"x"))
    monkeypatch.setattr(drive_sync.ingest, "create_version", lambda *a: ("v1", True))  # already the app's sheet
    db = DB(
        drive_files=[{"drive_file_id": "d1", "song_id": "s1", "status": "synced", "name": "d1.docx"},
                     {"drive_file_id": "d2", "song_id": "s1", "status": "synced", "name": "d2.docx"}],
        songs=[{"id": "s1", "title": "Been So Good", "duplicate_drive_at": "2026-11-27"}], song_events=[])
    out = drive_sync.keep_file(db, "s1", "d2")
    assert out["status"] == "done", out
    assert ("update", "d1", {"trashed": True}) in drive.calls
    assert [r["status"] for r in db.tables["drive_files"]] == ["removed", "synced"]
    assert db.tables["songs"][0]["duplicate_drive_at"] is None
