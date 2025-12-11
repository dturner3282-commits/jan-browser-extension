#!/usr/bin/env python3
"""
OFFLINE VALIDATOR — RUN ONLY ON AIR-GAPPED MACHINE
Purpose: Quick checks to confirm an air-gapped Windows/macOS machine is set up for local RAG (LM Studio + Jan).

How to use (Windows PowerShell example):
  python .\offline_validator.py --target "C:\Users\You\MyDocs" --recursive --lm-ports 1234,11434 --json

Notes:
- This script only uses the standard library and performs short, local network checks.
- It attempts small TCP connections to test whether the machine has any outward network reachability.
- Do NOT run on a machine you do not intend to verify as air-gapped.
"""

from __future__ import annotations
import argparse
import json
import socket
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import List, Tuple

OFFICE_EXTS = {'.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.ods', '.odp'}
DOCX_ONLY = {'.docx'}
PPTX_ONLY = {'.pptx'}
XLSX_ONLY = {'.xlsx'}


def check_internet(timeout: float = 2.0) -> bool:
    """Return True if any external host is reachable (indicates the machine is NOT air-gapped)."""
    hosts = [("8.8.8.8", 53), ("1.1.1.1", 53), ("93.184.216.34", 80)]  # example.com IP
    for host, port in hosts:
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return True
        except Exception:
            continue
    # Try a DNS lookup as a last check (may use cached results on some systems)
    try:
        socket.getaddrinfo("example.com", 80)
        return True
    except Exception:
        return False


def detect_lm_server(ports: List[int], timeout: float = 0.8) -> Tuple[bool, int | None]:
    """Try connecting to localhost on provided ports. Return (found, port).
    If ports is empty, skip and return (False, None).
    """
    for p in ports:
        try:
            with socket.create_connection(("127.0.0.1", p), timeout=timeout):
                return True, p
        except Exception:
            continue
    return False, None


def check_libreoffice() -> dict:
    """Detect LibreOffice presence and version if available."""
    possible = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "soffice",
        "libreoffice",
    ]
    for p in possible:
        try:
            # If it's an executable path, check existence first
            if p in ("soffice", "libreoffice"):
                # Try running by name (PATH)
                proc = subprocess.run([p, "--version"], capture_output=True, text=True, check=False)
            else:
                path = Path(p)
                if not path.exists():
                    continue
                proc = subprocess.run([str(path), "--version"], capture_output=True, text=True, check=False)
            out = (proc.stdout or "").strip() or (proc.stderr or "").strip()
            if out:
                first = out.splitlines()[0].strip()
                return {"installed": True, "path": p, "version": first}
        except Exception:
            continue
    return {"installed": False, "path": None, "version": None}


def find_convert_script(target_dir: Path, name: str = "convert_to_pdf.py") -> Tuple[bool, str | None]:
    # Check current working directory and target_dir for the script
    cwd = Path.cwd()
    candidates = [cwd / name, target_dir / name]
    for c in candidates:
        if c.exists():
            return True, str(c.resolve())
    return False, None


def scan_files(target_dir: Path, recursive: bool = True) -> dict:
    files = []
    if recursive:
        it = target_dir.rglob("*")
    else:
        it = target_dir.iterdir()
    for p in it:
        if p.is_file():
            ext = p.suffix.lower()
            if ext in {'.pdf', '.txt', '.md'} or ext in OFFICE_EXTS:
                stat = p.stat()
                files.append({
                    "full_path": str(p.resolve()),
                    "relative_path": str(p.relative_to(target_dir)),
                    "name": p.name,
                    "ext": ext,
                    "size_bytes": stat.st_size,
                    "modified_iso8601": datetime.utcfromtimestamp(stat.st_mtime).replace(microsecond=0).isoformat() + "Z"
                })
    # counts
    counts = {"docx": 0, "pptx": 0, "xlsx": 0, "pdf": 0, "txt": 0, "md": 0, "other_office": 0}
    total_office_size = 0
    office_like = {'.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.odt', '.ods', '.odp'}
    for f in files:
        ext = f['ext']
        if ext == '.pdf':
            counts['pdf'] += 1
        elif ext == '.txt':
            counts['txt'] += 1
        elif ext == '.md':
            counts['md'] += 1
        elif ext in DOCX_ONLY:
            counts['docx'] += 1
        elif ext in PPTX_ONLY:
            counts['pptx'] += 1
        elif ext in XLSX_ONLY:
            counts['xlsx'] += 1
        elif ext in office_like:
            counts['other_office'] += 1
        if ext in office_like:
            total_office_size += int(f['size_bytes'])

    # sample selection: pick up to 10, trying to represent types
    sample_files = []
    # prefer pdf, office, txt, md
    def pick(ext_list, limit):
        nonlocal sample_files
        for f in files:
            if f['ext'] in ext_list and len(sample_files) < limit and f not in sample_files:
                sample_files.append(f)
    pick(['.pdf'], 3)
    pick(list(office_like), 5)
    pick(['.txt'], 1)
    pick(['.md'], 1)
    # fallback fill
    for f in files:
        if len(sample_files) >= 10:
            break
        if f not in sample_files:
            sample_files.append(f)

    return {
        'files': files,
        'counts': counts,
        'total_office_size_bytes': total_office_size,
        'sample_files': sample_files[:10]
    }


def main():
    parser = argparse.ArgumentParser(description="Offline validator for air-gapped LM Studio + Jan setups")
    parser.add_argument('--target', '-t', default='.', help='Folder to scan for documents (default: current directory)')
    parser.add_argument('--recursive', '-r', action='store_true', help='Search folders recursively')
    parser.add_argument('--lm-ports', default=None, help='Comma-separated localhost ports to try for LM Studio / Jan (optional)')
    parser.add_argument('--convert-script-name', default='convert_to_pdf.py', help='Name of local convert script to look for')
    parser.add_argument('--json', action='store_true', help='Output machine-readable JSON summary')
    args = parser.parse_args()

    target_dir = Path(args.target).expanduser().resolve()
    if not target_dir.exists() or not target_dir.is_dir():
        print(f"❌ ERROR: target folder does not exist: {target_dir}")
        sys.exit(2)

    print("🛡️  AIR-GAP VALIDATION STARTED")

    # 1. Internet check
    internet = check_internet()
    if internet:
        print("❌ FAIL: Internet is reachable (not air-gapped). Stop and disconnect before continuing.)")
        # still produce a JSON summary if requested
    else:
        print("✅ PASS: No internet detected")

    # 2. LM Studio server check (optional)
    lm_ports = []
    if args.lm_ports:
        try:
            lm_ports = [int(x) for x in args.lm_ports.split(',') if x.strip()]
        except ValueError:
            print("⚠️  Invalid --lm-ports value; expecting comma-separated integers")
            lm_ports = []
    if lm_ports:
        found, port = detect_lm_server(lm_ports)
        if found:
            print(f"✅ PASS: LM Studio/Jan server listening on localhost:{port}")
        else:
            print(f"⚠️  WARNING: No server detected on localhost ports: {lm_ports}")
            print("   → If LM Studio provides a local server, start it and run this validator again.")
    else:
        print("ℹ️  LM Studio/Jan server check skipped (no ports provided). Use --lm-ports to enable")

    # 3. LibreOffice
    lo = check_libreoffice()
    if lo['installed']:
        print(f"✅ PASS: LibreOffice found: {lo['path']} ({lo['version']})")
    else:
        print("⚠️  WARNING: LibreOffice not detected on PATH or common install locations")
        print("   → If you need to convert office files to PDF offline, install LibreOffice first.")

    # 4. Scan files
    scan = scan_files(target_dir, recursive=args.recursive)
    counts = scan['counts']
    print(f"\n📂 Files found in {target_dir}: ")
    print(f"  PDFs: {counts['pdf']}  TXT: {counts['txt']}  MD: {counts['md']}")
    print(f"  docx: {counts['docx']}  pptx: {counts['pptx']}  xlsx: {counts['xlsx']}  other office: {counts['other_office']}")
    if scan['total_office_size_bytes']:
        print(f"  Total office files size: {scan['total_office_size_bytes']:,} bytes")

    # 5. Convert script
    conv_found, conv_path = find_convert_script(target_dir, args.convert_script_name)
    if conv_found:
        print(f"✅ PASS: Convert script found: {conv_path}")
    else:
        if counts['docx'] + counts['pptx'] + counts['xlsx'] + counts['other_office'] > 0:
            print("⚠️  WARNING: Office files exist but convert script not found. Please place 'convert_to_pdf.py' in the folder to run conversions offline.")
        else:
            print("ℹ️  No office files detected; conversion not required")

    # 6. Manual RAG check instruction
    print('\n🔍 MANUAL TEST (user action required)')
    print("  1) Open Jan (offline)")
    print("  2) Ask: 'What is in test_document.pdf? Show source.'")
    print("  3) Verify the response includes 'Source: test_document.pdf' or similar file reference")

    result = {
        'ok': not internet,
        'errors': [] if not internet else ['Internet reachable from this machine'],
        'libreoffice': lo,
        'convert_script': {'found': conv_found, 'path': conv_path},
        'counts': counts,
        'total_office_size_bytes': int(scan['total_office_size_bytes']),
        'sample_files': scan['sample_files'],
        'recommend_convert': (counts['docx'] + counts['pptx'] + counts['xlsx'] + counts['other_office']) > 0,
        'recommended_next_steps': [],
        'human_summary': '',
        'response_version': '1.1'
    }

    # recommended next steps (short, offline only)
    if result['recommend_convert']:
        result['recommended_next_steps'].append(f"Run the local convert script '{args.convert_script_name}' to convert office files in '{target_dir}' to PDF and save them in a 'pdf_ready' folder.")
        result['recommended_next_steps'].append("When PDFs are produced, open Jan and point it to the folder containing PDFs, then index the files.")
    else:
        result['recommended_next_steps'].append("Open Jan and point it to the folder containing your documents, then index them.")

    # human summary
    summary_parts = []
    total_office = counts['docx'] + counts['pptx'] + counts['xlsx'] + counts['other_office']
    summary_parts.append(f"Found {total_office} office files and {counts['pdf']} PDFs in '{target_dir.name}'.")
    summary_parts.append("LibreOffice is installed." if lo['installed'] else "LibreOffice not detected.")
    result['human_summary'] = ' '.join(summary_parts)

    if args.json:
        print('\n' + json.dumps(result, indent=2))
    else:
        print('\n✅ SUMMARY:')
        print('  ' + result['human_summary'])
        if result['recommended_next_steps']:
            print('\n  Recommended next steps:')
            for s in result['recommended_next_steps']:
                print('   - ' + s)

    # Final exit code: 0 if offline, 1 if internet detected
    if internet:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == '__main__':
    main()
