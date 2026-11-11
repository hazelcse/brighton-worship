from worship_worker.docx_text import Block, DocText
from worship_worker.scanner import clean_title, expand_section_label, scan_text


def doc(body: list[str], *boxes: list[str]) -> DocText:
    return DocText([Block("body", body), *[Block("textbox", b) for b in boxes]], hyperlinks=[])


def test_section_labels():
    assert expand_section_label("Intro / Verse 1 / 2 / 3") == ["Intro", "Verse 1", "Verse 2", "Verse 3"]
    assert expand_section_label("Chorus 2 (When Repeat)") == ["Chorus 2"]
    assert expand_section_label("Pre-Chorus") == ["Pre-Chorus"]
    assert expand_section_label("Chorus to Verse") == []


def test_titles():
    assert clean_title("\tABIDE (E-F#)") == ("Abide", "E-F#")
    assert clean_title("CROSSING OVER (Key: G-A)")[0] == "Crossing Over"


def test_scan_with_explicit_key_change():
    r = scan_text(doc(
        ["\tABIDE (E-F#)", "Verse 1:For my waking breath", "Chorus 1:", "You're the Way"],
        ["Tempo: 74 bpm", "Time Signature: 6/8", "E Major", "Intro / Verse 1:",
         "||:   E\t|  ~ |  B |  ~ |", "|  C#m | ~ | A | ~ :||",
         "F# Major", "Chorus 2:", "||:  F# | ~ | C# | ~ |", "| G#m | D#m | B | C# :||"],
        ["Original Key: B (Male)", "Artist: Dwell Songs", "YouTube Link: https://www.youtube.com/watch?v=JcZS_-Yc170"],
    ))
    assert r.title == "Abide"
    assert r.bpm == 74 and r.time_signature == "6/8"
    assert r.key_display == "E→F#"
    assert r.artist == "Dwell Songs" and r.original_key == "B (Male)"
    assert r.youtube_links == ["https://www.youtube.com/watch?v=JcZS_-Yc170"]
    assert r.lyric_sequence == ["Verse 1", "Chorus 1"]
    assert r.suggested_type == "worship"


def test_stale_written_key_is_overridden():
    r = scan_text(doc(["WAY MAKER"], ["A Major", "Verse:", "||:  F | C | Gsus | Am :||", "Chorus:", "||: F | C | G | Am :||"]))
    assert r.key_display == "C"
    assert any(i.code == "written_key_mismatch" for i in r.issues)


def test_chinese_with_pinyin():
    r = scan_text(doc(["I SPEAK JESUS", "Verse 1:", "我只想要宣告 救主耶稣", "wo zhi xiang yao xuan gao jiu zhu ye su"]))
    assert r.language == "zh"


# --- Chinese sheets ------------------------------------------------------------


def test_key_line_with_details():
    r = scan_text(doc(
        ["生命在于祢", "Key: G |  = 140  | 4/4｜https://youtu.be/lSlL03b3zG8", "Verse", "生命在于祢，主，"],
        ["Intro/Verse", "||: G | G |", "| Em | Em |", "| C | C | G | D :||", "Chorus", "| C | D | G | G |"],
    ))
    assert r.key_display == "G" and r.key_regions[0].source == "explicit"
    assert r.bpm == 140 and r.time_signature == "4/4"
    assert r.chart_sequence == ["Intro", "Verse", "Chorus"]


def test_key_line_artist_and_album():
    r = scan_text(doc(
        ["在你宝座前", "Key: A |  = 146  | 4/4 | 赞美之泉11 - 宝贵十架 | https://youtu.be/z11OfOcMfbg", "Verse 1", "在祢宝座前"],
        ["Intro / Music", "||: A｜A/G#｜F#m｜A/E :||", "Verse 1／2", "| A | E/G#  | D/F# | E/G# |", "| D｜Bm | E | E |"],
    ))
    assert r.artist == "赞美之泉"
    assert r.key_display == "A"  # full-width bars read as bars
    assert r.chart_sequence == ["Intro", "Music", "Verse 1", "Verse 2"]


def test_scripture_is_not_the_artist():
    r = scan_text(doc(["圣所", "Key: A | ♩ = 75  | 4/4 | 1 John 4:19; Matt 26:28｜City Harvest Church", "Verse", "当天地一片黑暗"]))
    assert r.bpm == 75 and r.artist == "City Harvest Church"


def test_sequence_box():
    r = scan_text(doc(
        ["敬拜你", "Key: G | ♩ = 73", "[Verse 1]", "敬拜祢，全能主上帝，"],
        ["Sequence", "Intro (AG 1x, whole band next)", "Verse x2", "(last line half-time)", "Chorus (half time)", "L2L", "LL x2", "Outtro"],
    ))
    assert r.sequence == ["Intro", "Verse", "Verse", "Chorus", "L2L", "LL", "LL", "Outro"]
    assert r.lyric_sequence == ["Verse 1"]  # the list isn't lyrics


def test_chart_copies_under_one_written_key():
    chart = lambda a, b, c: ["Intro", f"| {a} | {b} | {c} | {a} |", "Chorus", f"| {b} | {c} | {a} | {a} |"]
    r = scan_text(doc(
        ["耶和华行了大事", "Key: Bb | 148 BPM | 4/4", "Verse 1", "耶和华已经为我们行了大事", "Key: G (capo 3) | 148 BPM"],
        chart("Bb", "Eb", "F"), chart("G", "C", "D"), chart("A", "D", "E"),
    ))
    assert r.key_display == "Bb" and r.alternate_keys == ["G", "A"]
    assert not any(i.code == "written_key_mismatch" for i in r.issues)


def test_chinese_title_tags_artist_and_medley():
    r = scan_text(doc(["在你没有难成的事 【Youtube】", "Verse", "芥菜种的信心"]))
    assert r.title == "在你没有难成的事"
    r = scan_text(doc(["求主充滿我 （赞美之泉）", "Verse", "主 我来寻求祢的面", "十字架（赞美之泉）", "十字架 十字架"]))
    assert r.title == "求主充滿我 / 十字架" and r.artist == "赞美之泉"


def test_bilingual_title_and_heading_key_without_chords():
    r = scan_text(doc([
        "\tLIVING HOPE (G)", "\tVerse 1:", "How great the chasm that lay between us", "Chorus:", "Hallelujah",
        "我的盼望", "Verse 1:", "多大的裂缝 在祢我之间", "Chorus:", "哈利路亚 赞美祂释放我心",
    ]))
    assert r.title == "我的盼望 - Living Hope"
    assert r.key_display == "G" and not any(i.severity == "error" for i in r.issues)
    r = scan_text(doc([
        "基督是我满足", "Key: G | 80 BPM", "Verse 1", "你 是 我 奖 赏", "Ni Shi Wo Jiang Shang",
        "CHRIST IS ENOUGH", "Key: G | 80 BPM", "Verse 1:", "Christ is my reward",
    ]))
    assert r.title == "基督是我满足 - Christ Is Enough"
