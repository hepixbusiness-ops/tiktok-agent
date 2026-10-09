"""Voix off + minutage de chaque mot (edge-tts, gratuit).
Usage : python3 tts_mots.py <voix> <débit> <texte> <sortie.mp3> <sortie.json>"""
import asyncio
import json
import sys

import edge_tts


async def main(voix, debit, texte, mp3, sortie_json):
    com = edge_tts.Communicate(texte, voix, rate=debit, boundary="WordBoundary")
    mots = []
    with open(mp3, "wb") as f:
        async for bloc in com.stream():
            if bloc["type"] == "audio":
                f.write(bloc["data"])
            elif bloc["type"] == "WordBoundary":
                debut = bloc["offset"] / 1e7
                mots.append([debut, debut + bloc["duration"] / 1e7, bloc["text"]])
    with open(sortie_json, "w", encoding="utf-8") as f:
        json.dump(mots, f, ensure_ascii=False)


asyncio.run(main(*sys.argv[1:6]))
