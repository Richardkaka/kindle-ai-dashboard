from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
IMAGE = ROOT / "output" / "dashboard.png"


def main() -> None:
    image = Image.open(IMAGE)
    # Kindle PW2/eips is happiest with native 8-bit grayscale PNGs.
    image.convert("L").save(IMAGE, optimize=True)
    print(f"Post-processed {IMAGE} as 8-bit grayscale PNG")


if __name__ == "__main__":
    main()
