"""Generate two small uploadable demo PDFs, using only the Python standard library."""
import argparse
import tempfile
from pathlib import Path


def write_pdf(destination: Path, lines: list[str]):
    commands = ["BT /F1 16 Tf 72 720 Td"]
    for i, text in enumerate(lines):
        if i:
            commands.append("0 -26 Td")
        escaped = text.replace("\\",
                               "\\\\").replace("(", "\\(").replace(")", "\\)")
        commands.append(f"({escaped}) Tj")
    commands.append("ET")
    stream = "\n".join(commands).encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n".encode() + stream +
        b"\nendstream",
    ]
    document = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(document))
        document.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    start = len(document)
    document.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        document.extend(f"{offset:010d} 00000 n \n".encode())
    document.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n"
        .encode())
    destination.write_bytes(document)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output",
                        type=Path,
                        default=Path(tempfile.gettempdir()) /
                        "illinois-nlip-demo-pdfs")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    write_pdf(args.output / "course-slides.pdf", [
        "Course field trip",
        "The field trip takes place outdoors in Champaign.",
        "Ask the Lab TA for orientation time and meeting place.",
        "Ask the Weather Agent for rain precautions.",
    ])
    write_pdf(args.output / "lab-orientation.pdf", [
        "Lab orientation",
        "Orientation starts at 09:00.",
        "Meet at the north entrance.",
    ])
    print(f"Demo PDFs written to {args.output}")
