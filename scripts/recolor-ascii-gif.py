#!/usr/bin/env python3
import sys
from pathlib import Path

from PIL import Image, ImageSequence


BACKGROUND = (5, 6, 11, 255)


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: recolor-ascii-gif.py <source.gif> <output.gif> <hex-color>", file=sys.stderr)
        return 2

    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    accent = parse_hex(sys.argv[3])

    if not source.exists():
        print(f"source gif not found: {source}", file=sys.stderr)
        return 1

    highlight = blend(accent, (255, 255, 255), 0.34)
    shadow = blend(accent, BACKGROUND[:3], 0.62)

    with Image.open(source) as image:
        frames = []
        durations = []

        for frame in ImageSequence.Iterator(image):
            durations.append(frame.info.get("duration", image.info.get("duration", 100)))
            frames.append(recolor_frame(frame.convert("RGBA"), accent, highlight, shadow))

        frames[0].save(
            output,
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=image.info.get("loop", 0),
            disposal=2,
            optimize=True,
        )

    return 0


def recolor_frame(frame: Image.Image, accent: tuple[int, int, int], highlight: tuple[int, int, int], shadow: tuple[int, int, int]) -> Image.Image:
    pixels = []

    for red, green, blue, alpha in frame.getdata():
        if alpha == 0 or max(red, green, blue) <= 16:
            pixels.append(BACKGROUND)
            continue

        luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
        normalized = max(0, min(1, (luminance - 0.035) / 0.965))
        strength = normalized ** 0.82

        if strength < 0.42:
            color = blend(BACKGROUND[:3], shadow, strength / 0.42)
        elif strength < 0.82:
            color = blend(shadow, accent, (strength - 0.42) / 0.4)
        else:
            color = blend(accent, highlight, (strength - 0.82) / 0.18)

        pixels.append((*color, alpha))

    output = Image.new("RGBA", frame.size, BACKGROUND)
    output.putdata(pixels)
    return output


def parse_hex(value: str) -> tuple[int, int, int]:
    cleaned = value.strip().lstrip("#")
    if len(cleaned) != 6:
        raise ValueError(f"expected 6-digit hex color, got {value!r}")
    return tuple(int(cleaned[index:index + 2], 16) for index in (0, 2, 4))


def blend(left: tuple[int, int, int], right: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    ratio = max(0, min(1, amount))
    return tuple(round(a + (b - a) * ratio) for a, b in zip(left, right))


if __name__ == "__main__":
    raise SystemExit(main())
