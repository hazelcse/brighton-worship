from worship_worker.music import chords_in_line, estimate_key, parse_chord, parse_key_name, semitones_between


def test_parse_chords():
    for token in ["E", "F#m", "C#m7", "E/G#", "Bbsus4", "Dma7", "Amaj7", "F#5", "D6add9", "Asus2", "Gsus", "Am7b5"]:
        assert parse_chord(token), token
    for word in ["Bless", "And", "Be", "Hope", "Am I"]:
        assert parse_chord(word) is None, word


def test_chord_lines_vs_lyrics():
    assert chords_in_line("||:   E\t|      ~\t|     B\t|      ~\t|")
    assert chords_in_line("|| Bb/ F  F || (to verse)")
    assert chords_in_line("|  A  -  -   E/G#  |")
    assert chords_in_line("A melody that's never failed") is None
    assert chords_in_line("Be my strength my song in the night") is None


def test_key_estimation():
    chords = [parse_chord(c) for c in "E B C#m A E B F#m C#m A B".split()]
    assert estimate_key(chords)[0] == "E"
    chords = [parse_chord(c) for c in "F C G Am F C G Am7".split()]
    assert estimate_key(chords)[0] == "C"


def test_key_names_and_intervals():
    assert parse_key_name("F# Major") == "F#"
    assert parse_key_name("bb") == "Bb"
    assert semitones_between("E", "F#") == 2
    assert semitones_between("G", "E") == -3
