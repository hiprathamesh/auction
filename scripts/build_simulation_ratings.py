"""Build player skill estimates from a Cricsheet IPL JSON ZIP and People CSV."""
import argparse
from collections import Counter, defaultdict
import csv
import json
from pathlib import Path
import re
from statistics import mean
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
RECENT = range(2023, 2026)
PHASES = ("powerplay", "middle", "death")
ALIASES = {
    "ab-de-villiers": "AB de Villiers",
    "ms-dhoni": "MS Dhoni",
    "vaibhav-suryavanshi": "V Suryavanshi",
    "naman-dhir": "Naman Dhir",
    "jasprit-bumrah": "JJ Bumrah",
    "virat-kohli": "V Kohli",
    "suryakumar-yadav": "SA Yadav",
    "rohit-sharma": "RG Sharma",
    "r-ashwin": "R Ashwin",
    "mohammad-siraj": "Mohammed Siraj",
    "mohammad-shami": "Mohammed Shami",
    "cameron-green": "C Green",
    "dinesh-karthik": "KD Karthik",
    "dwayne-bravo": "DJ Bravo",
    "finn-allen": "FH Allen",
    "nitish-kumar-reddy": "Nithish Kumar Reddy",
    "rinku-singh": "RK Singh",
    "rp-singh": "RP Singh",
    "sai-sudharsan": "B Sai Sudharsan",
    "sarfaraz-khan": "SN Khan",
    "shahrukh-khan": "M Shahrukh Khan",
    "varun-chakravarthy": "CV Varun",
    "quinton-de-kock": "Q de Kock",
    "rashid-khan": "Rashid Khan",
}


def normalized(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def clamp(value, low=12, high=99):
    return max(low, min(high, round(value)))


def load_data(archive):
    players = defaultdict(Counter)
    league = defaultdict(Counter)
    names = defaultdict(set)
    with ZipFile(archive) as files:
        for file in files.namelist():
            if not file.endswith(".json"):
                continue
            match = json.loads(files.read(file))
            info = match["info"]
            year = int(info["dates"][0][:4])
            if year > max(RECENT):
                continue
            registry = info["registry"]["people"]
            for name, identifier in registry.items():
                names[normalized(name)].add(identifier)
            for innings in match["innings"]:
                if innings.get("super_over"):
                    continue
                for over in innings["overs"]:
                    number = over["over"]
                    phase = PHASES[0 if number < 6 else 1 if number < 15 else 2]
                    for ball in over["deliveries"]:
                        extra = ball.get("extras", {})
                        illegal = bool(extra.get("wides") or extra.get("noballs"))
                        runs = ball["runs"]["batter"]
                        bowler_wickets = sum(w["kind"] in (
                            "bowled", "caught", "caught and bowled", "lbw", "stumped", "hit wicket",
                        ) for w in ball.get("wickets", []))
                        batting = Counter(batBalls=int(not illegal), batOut=bowler_wickets,
                                          rotate=int(0 < runs < 4), hits=int(runs in (4, 6)))
                        bowling = Counter(bowlBalls=int(not illegal), charged=runs + extra.get("wides", 0)
                                          + extra.get("noballs", 0), wickets=bowler_wickets,
                                          illegal=int(illegal))
                        players[registry[ball["batter"]], year, phase].update(batting)
                        players[registry[ball["bowler"]], year, phase].update(bowling)
                        league[year, phase].update(batting + bowling)
    return players, league, names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("match_zip")
    parser.add_argument("people_csv")
    args = parser.parse_args()
    players, league, names = load_data(args.match_zip)
    observed_ids = {identifier for identifier, _, _ in players}
    with open(args.people_csv, encoding="utf-8-sig", newline="") as source:
        people = list(csv.DictReader(source))
    by_cricbuzz = {row["key_cricbuzz"]: row["identifier"] for row in people if row["key_cricbuzz"]}
    for row in people:
        for key in ("name", "unique_name"):
            names[normalized(row[key])].add(row["identifier"])

    def identify(player):
        name = ALIASES.get(player["id"], player["name"])
        if player["id"] == "rashid-khan":
            return "5f547c8b"
        ids = names.get(normalized(name), set()) & observed_ids
        if len(ids) == 1:
            return next(iter(ids))
        url = player.get("photoAttribution", {}).get("sourceUrl", "")
        match = re.search(r"cricbuzz\.com/profiles/(\d+)", url)
        cricbuzz = by_cricbuzz.get(match[1]) if match else None
        if cricbuzz in observed_ids:
            return cricbuzz
        # Match abbreviated given names only when the full surname and initials
        # identify a single player in the IPL records.
        words = name.split()
        aliases = set()
        for length in range(1, min(3, len(words) - 1) + 1):
            initials = "".join(word[0] for word in words[:length])
            short = normalized(initials + " ".join(words[length:]))
            aliases.update(names.get(short, set()) & observed_ids)
        surname = normalized(words[-1])
        for row in people:
            if row["identifier"] not in observed_ids:
                continue
            parts = row["name"].split()
            if len(parts) == 2 and normalized(parts[-1]) == surname and parts[0].isupper() and parts[0][0].lower() == words[0][0].lower():
                aliases.add(row["identifier"])
        return next(iter(aliases)) if len(aliases) == 1 else None

    def estimate(identifier, years, phases, stat, ball_type, prior):
        sample = sum(players[identifier, year, phase][ball_type] for year in years for phase in phases)
        actual = sum(players[identifier, year, phase][stat] for year in years for phase in phases)
        expected = sum(
            players[identifier, year, phase][ball_type] * league[year, phase][stat] /
            max(1, league[year, phase][ball_type]) for year in years for phase in phases
        )
        return (actual - expected) / (sample + prior), sample

    source = json.loads((ROOT / "data/players.json").read_text(encoding="utf-8"))
    result = {}
    for player in source["players"]:
        pid = player["id"]
        identifier = identify(player)
        if identifier is None:
            continue
        years = RECENT
        if player["legend"]:
            # Prefer a sustained IPL peak to a single hot season.
            windows = [range(year, year + 3) for year in range(2008, 2024)]
            def peak(window):
                bat, faced = estimate(identifier, window, PHASES, "hits", "batBalls", 200)
                bowl, delivered = estimate(identifier, window, PHASES, "charged", "bowlBalls", 180)
                return bat * 3 - bowl + min(1, (faced + delivered) / 500) * 0.04
            years = max(windows, key=peak)
        hit, faced = estimate(identifier, years, PHASES, "hits", "batBalls", 180)
        rotate, _ = estimate(identifier, years, PHASES, "rotate", "batBalls", 180)
        outs, _ = estimate(identifier, years, PHASES, "batOut", "batBalls", 180)
        runs, delivered = estimate(identifier, years, PHASES, "charged", "bowlBalls", 150)
        wickets, _ = estimate(identifier, years, PHASES, "wickets", "bowlBalls", 150)
        illegal, _ = estimate(identifier, years, PHASES, "illegal", "bowlBalls", 150)
        if faced + delivered == 0:
            continue
        profile = {"id": identifier, "years": list(years), "batBalls": faced, "bowlBalls": delivered}
        bat_prior = min(94, player.get("ratingPrior", {}).get("batting", player["batting"]))
        bowl_prior = min(94, player.get("ratingPrior", {}).get("bowling", player["bowling"]))
        if player["role"] in ("Batter", "Wicketkeeper") and delivered < 30:
            bowl_prior = min(44, bowl_prior)
        if player["role"] == "All-rounder" and delivered < 120:
            bowl_prior = min(70, bowl_prior)
        bat = mean((bat_prior, 77)) if player["role"] != "Bowler" else bat_prior
        bowl = mean((bowl_prior, 77)) if delivered >= 120 else bowl_prior
        if faced >= 30:
            profile.update(survival=clamp(bat - outs * 450), rotation=clamp(bat + rotate * 120),
                           hitting=clamp(bat + hit * 210))
            candidates = {phase: estimate(identifier, years, (phase,), "hits", "batBalls", 125) for phase in PHASES}
            eligible = [phase for phase, (_, sample) in candidates.items() if sample >= 65]
            if eligible:
                best = max(eligible, key=lambda phase: candidates[phase][0])
                if candidates[best][0] > 0.008:
                    profile["battingPhase"] = best
        if delivered >= 20:
            profile.update(prevention=clamp(bowl - runs * 65), wickets=clamp(bowl + wickets * 450),
                           control=clamp(bowl - illegal * 325))
            candidates = {phase: estimate(identifier, years, (phase,), "charged", "bowlBalls", 100) for phase in PHASES}
            eligible = [phase for phase, (_, sample) in candidates.items() if sample >= 65]
            if eligible:
                best = min(eligible, key=lambda phase: candidates[phase][0])
                if candidates[best][0] < -0.035:
                    profile["bowlingPhase"] = best
        result[pid] = profile

    output = ROOT / "data/simulation-ratings.json"
    output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {len(result)} player profiles to {output}")


if __name__ == "__main__":
    main()
