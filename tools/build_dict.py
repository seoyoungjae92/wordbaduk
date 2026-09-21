#!/usr/bin/env python3
"""끝말잇기 대국 — 사전 빌드

index.html 안의 네 개 데이터 상수를 원천 데이터로부터 다시 만들어 넣는다.

  DICT_IDX    내가 쓸 수 있는 말. 첫 음절 -> 나머지 음절(개행 구분)
  DICT_TIERS  한글이가 아는 말. 말뭉치 빈도순 3단
  DEX_MAIN    도감 1권 15칸. '끝내는 글자' 중 흔한 말로 닿는 것
  DEX_HARD    도감 2권 13칸. 명사로는 닿지만 흔하지는 않은 것
  DEAD_ALL    끝내는 글자 전체(201자). 도감 밖 수집용

원천 데이터 세 가지는 tools/data/ 에 받아둔다. 없으면 내려받는다.

    python3 tools/build_dict.py            # 빌드해서 index.html에 주입
    python3 tools/build_dict.py --dry-run  # 통계만 출력
"""
import json, os, re, sys, urllib.request
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "tools", "data")
HTML = os.path.join(ROOT, "index.html")

SOURCES = {
    # 표준국어대사전 계열 표제어 목록 (366,505개)
    "kw1.txt":
        "https://raw.githubusercontent.com/acidsound/korean_wordlist/master/wordslistUnique.txt",
    # 자막 말뭉치 빈도 상위 5만 — '흔한 말'을 가리는 데만 쓴다
    "freq.txt":
        "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/ko/ko_50k.txt",
    # 명사 사전 — 자막 말뭉치에 섞인 '내가/거야/그래' 같은 비명사를 걸러낸다
    "nouns.txt":
        "https://raw.githubusercontent.com/open-korean-text/open-korean-text/master/"
        "src/main/resources/org/openkoreantext/processor/util/noun/nouns.txt",
}

SYLLABLE = re.compile(r"^[가-힣]{2,4}$")
# 두음법칙에서 ㅇ으로 바뀌는 중성: ㅑㅒㅕㅖㅛㅠㅣ
Y_VOWELS = {2, 3, 6, 7, 12, 17, 20}
TIER_CUTS = (20000, 50000)   # 빈도 순위 경계. 난이도가 이 단을 열고 닫는다


def fetch():
    os.makedirs(DATA, exist_ok=True)
    for name, url in SOURCES.items():
        path = os.path.join(DATA, name)
        if os.path.exists(path):
            continue
        print(f"  내려받는 중 {name} …")
        urllib.request.urlretrieve(url, path)
    return {n: os.path.join(DATA, n) for n in SOURCES}


def read_lines(path):
    with open(path, encoding="utf-8") as f:
        return [ln.strip() for ln in f]


def allowed_starts(ch):
    """두음법칙. 「락」으로 끝나면 「락」이나 「낙」으로 받을 수 있다."""
    out = [ch]
    code = ord(ch) - 0xAC00
    if not 0 <= code <= 11171:
        return out
    cho, jung, jong = code // 588, (code % 588) // 28, code % 28
    if cho == 5:      # ㄹ
        out.append(chr(0xAC00 + (11 if jung in Y_VOWELS else 2) * 588 + jung * 28 + jong))
    elif cho == 2 and jung in Y_VOWELS:   # ㄴ -> ㅇ
        out.append(chr(0xAC00 + 11 * 588 + jung * 28 + jong))
    return out


def build(paths):
    # 1. 끝말잇기에 쓸 수 있는 말만 남긴다.
    #    동사·형용사는 사전 표제어가 -다로 끝나므로 그걸로 거른다.
    words = sorted({w for w in read_lines(paths["kw1.txt"])
                    if SYLLABLE.match(w) and not w.endswith("다")})

    # 2. 빈도 순위. 낮을수록 흔하다.
    rank = {}
    for i, line in enumerate(read_lines(paths["freq.txt"])):
        parts = line.split()
        if parts:
            rank.setdefault(parts[0], i)

    # 3. 한글이의 어휘 = 사전 ∩ 명사. 빈도로 3단을 나눈다.
    nouns = set(w for w in read_lines(paths["nouns.txt"]) if w)
    basic = [w for w in words if w in nouns]
    tiers = [[], [], []]
    for w in basic:
        r = rank.get(w, 10 ** 9)
        tiers[0 if r < TIER_CUTS[0] else 1 if r < TIER_CUTS[1] else 2].append(w)

    # 4. 끝내는 글자 = 사전 전체에 이을 말이 없는 글자.
    firsts = Counter(w[0] for w in words)
    ends = {}
    for w in words:
        ends.setdefault(w[-1], []).append(w)
    dead = sorted(c for c in ends
                  if sum(firsts.get(s, 0) for s in allowed_starts(c)) == 0)

    # 5. 도감은 두 권이다.
    #    1권 = 흔한 말로 닿는 글자, 2권 = 명사로는 닿지만 흔하지 않은 글자.
    #    나머지는 고어·방언으로만 닿아서 수집 대상으로 부적합하다.
    dex, hard = [], []
    for c in dead:
        nearby = [w for w in ends[c] if w in nouns]
        if not nearby:
            continue
        nearby.sort(key=lambda w: rank.get(w, 10 ** 9))
        (dex if rank.get(nearby[0], 10 ** 9) < 60000 else hard).append({"s": c, "w": nearby[0]})
    dex.sort(key=lambda x: rank.get(x["w"], 10 ** 9))
    hard.sort(key=lambda x: rank.get(x["w"], 10 ** 9))

    # 6. 첫 음절을 키로 빼서 중복 3바이트를 없앤다.
    idx = {}
    for w in words:
        idx.setdefault(w[0], []).append(w[1:])

    return {
        "words": words, "tiers": tiers, "dex": dex, "hard": hard, "dead": dead,
        "idx": {k: "\n".join(v) for k, v in idx.items()},
        "probe": [w for w in basic if rank.get(w, 10 ** 9) < 60000],
    }


def coverage(tiers, probe):
    """한글이가 실제 플레이에서 응수할 수 있는 비율. 곧 사용자의 승률 상한."""
    out = []
    got = set()
    for t in range(3):
        got |= set(tiers[t])
        first = Counter(w[0] for w in got)
        ok = sum(1 for w in probe if any(first.get(s) for s in allowed_starts(w[-1])))
        out.append(ok / len(probe) * 100)
    return out


def inject(b):
    html = open(HTML, encoding="utf-8").read()
    payload = {
        "DEX_MAIN": json.dumps(b["dex"], ensure_ascii=False, separators=(",", ":")),
        "DEX_HARD": json.dumps(b["hard"], ensure_ascii=False, separators=(",", ":")),
        "DEAD_ALL": json.dumps("".join(b["dead"]), ensure_ascii=False),
        "DICT_IDX": json.dumps(b["idx"], ensure_ascii=False, separators=(",", ":")),
        "DICT_TIERS": json.dumps(["\n".join(t) for t in b["tiers"]],
                                 ensure_ascii=False, separators=(",", ":")),
    }
    for name, value in payload.items():
        assert "\n" not in value, f"{name}에 실제 개행이 있으면 JS 문자열이 깨진다"
        pattern = r"var " + name + r"\s*=\s*.*?;\n"
        assert re.search(pattern, html, re.S), f"{name} 선언을 찾지 못했다"
        # re.sub 치환문은 역슬래시를 해석하므로 lambda로 넘긴다
        html = re.sub(pattern, lambda m, v=value, n=name: f"var {n} = {v};\n",
                      html, count=1, flags=re.S)
    open(HTML, "w", encoding="utf-8").write(html)
    return os.path.getsize(HTML)


def main():
    dry = "--dry-run" in sys.argv
    print("원천 데이터 확인")
    paths = fetch()
    print("사전 빌드")
    b = build(paths)
    cov = coverage(b["tiers"], b["probe"])

    print()
    print(f"  내가 쓸 수 있는 말   {len(b['words']):,}   (2~4음절 · 순한글 · 동사 제외)")
    print(f"  한글이가 아는 말     {sum(len(t) for t in b['tiers']):,}   "
          f"(1단 {len(b['tiers'][0]):,} / 2단 {len(b['tiers'][1]):,} / 3단 {len(b['tiers'][2]):,})")
    print(f"  단 별 응수 가능률    {cov[0]:.1f}% → {cov[1]:.1f}% → {cov[2]:.1f}%")
    print(f"  끝내는 글자          {len(b['dead'])}   "
          f"(도감 1권 {len(b['dex'])}칸 + 2권 {len(b['hard'])}칸, 나머지는 고어·방언뿐)")
    print(f"  1권                  {' '.join(m['s'] + '(' + m['w'] + ')' for m in b['dex'])}")
    print(f"  2권                  {' '.join(m['s'] + '(' + m['w'] + ')' for m in b['hard'])}")
    print()

    if dry:
        print("--dry-run 이라 index.html은 건드리지 않았다")
        return
    size = inject(b)
    print(f"index.html 주입 완료 — {size / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
