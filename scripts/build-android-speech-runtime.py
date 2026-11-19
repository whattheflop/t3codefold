#!/usr/bin/env python3
"""Rebuild Moonshine's Android AAR against ONNX Runtime's corrected ARM dispatch."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import tarfile
import urllib.request
import zipfile

MOONSHINE = "0.1.6"
ORT = "1.25.1"
NDK = "28.0.13004108"
ABIS = {"arm64-v8a": ("arm64", 183), "x86_64": ("x86_64", 62), "armeabi-v7a": ("armeabi-v7a", 40)}
SOURCE_SHA = "58a8636c38b88c316aea6d3ffecbf88a7c590d0817eb2cda761ad21efa170637"
ORT_SHA = "08ccb60c93bd027843e8227743ddcb0275a00ee706cb0df4bae91cc1a21a55f5"


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(url, path, expected):
    if not path.exists():
        temporary = path.with_suffix(path.suffix + ".part")
        urllib.request.urlretrieve(url, temporary)
        temporary.replace(path)
    if sha256(path) != expected:
        raise ValueError(f"Checksum mismatch: {path.name}")


def verify(artifact):
    with zipfile.ZipFile(artifact) as archive:
        for abi, (_, machine) in ABIS.items():
            for name in ("libmoonshine.so", "libmoonshine-jni.so", "libonnxruntime.so"):
                data = archive.read(f"jni/{abi}/{name}")
                if data[:4] != b"\x7fELF" or struct.unpack_from("<H", data, 18)[0] != machine:
                    raise ValueError(f"Wrong ELF architecture: {abi}/{name}")
                if name in ("libmoonshine.so", "libonnxruntime.so"):
                    if f"VERS_{ORT}\0".encode() not in data or b"VERS_1.23.2\0" in data:
                        raise ValueError(f"{abi}/{name} must link ONNX {ORT}, not the SIGILL-affected 1.23.2")
                if abi != "armeabi-v7a":
                    offset = struct.unpack_from("<Q", data, 32)[0]
                    size, count = struct.unpack_from("<HH", data, 54)
                    for index in range(count):
                        entry = offset + index * size
                        if struct.unpack_from("<I", data, entry)[0] == 1:
                            if struct.unpack_from("<Q", data, entry + 48)[0] < 16384:
                                raise ValueError(f"Missing 16 KiB ELF alignment: {abi}/{name}")
        archive.read("classes.jar")
    print(f"Verified all three ABIs, ONNX {ORT} linkage and 16 KiB alignment: {artifact}")


def build(work, sdk):
    work.mkdir(parents=True, exist_ok=True)
    source_archive = work / f"moonshine-v{MOONSHINE}.tar.gz"
    ort_archive = work / f"onnxruntime-android-{ORT}.aar"
    download(f"https://codeload.github.com/moonshine-ai/moonshine/tar.gz/refs/tags/v{MOONSHINE}", source_archive, SOURCE_SHA)
    download(f"https://repo.maven.apache.org/maven2/com/microsoft/onnxruntime/onnxruntime-android/{ORT}/onnxruntime-android-{ORT}.aar", ort_archive, ORT_SHA)
    source = work / f"moonshine-{MOONSHINE}"
    if not source.exists():
        with tarfile.open(source_archive) as archive:
            archive.extractall(work, filter="data")
    host = {"Linux": "linux-x86_64", "Darwin": "darwin-x86_64"}[platform.system()]
    ndk = sdk / "ndk" / NDK
    cmake = sdk / "cmake" / "3.22.1" / "bin" / "cmake"
    strip = ndk / "toolchains" / "llvm" / "prebuilt" / host / "bin" / "llvm-strip"
    if not cmake.exists() or not strip.exists():
        raise ValueError(f"Install Android SDK CMake 3.22.1 and NDK {NDK}")
    libraries = {}
    with zipfile.ZipFile(ort_archive) as archive:
        for abi, (folder, _) in ABIS.items():
            ort = source / "core/third-party/onnxruntime/lib/android" / folder / "libonnxruntime.so"
            ort.write_bytes(archive.read(f"jni/{abi}/libonnxruntime.so"))
            native = work / f"build-{abi}"
            subprocess.run([str(cmake), "-S", str(source / "core"), "-B", str(native), "-G", "Ninja",
                            f"-DCMAKE_MAKE_PROGRAM={cmake.parent / 'ninja'}",
                            f"-DCMAKE_TOOLCHAIN_FILE={ndk / 'build/cmake/android.toolchain.cmake'}",
                            f"-DANDROID_ABI={abi}", "-DANDROID_PLATFORM=android-26", "-DCMAKE_BUILD_TYPE=Release",
                            "-DANDROID_STL=c++_static", "-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON"], check=True)
            subprocess.run([str(cmake), "--build", str(native), "--target", "moonshine-jni", "--parallel", "4"], check=True)
            for name, binary in (("libmoonshine.so", native / "libmoonshine.so"),
                                 ("libmoonshine-jni.so", native / "moonshine-jni/libmoonshine-jni.so"),
                                 ("libonnxruntime.so", ort)):
                packaged = work / f"packaged-{abi}-{name}"
                shutil.copyfile(binary, packaged)
                subprocess.run([str(strip), "--strip-unneeded", str(packaged)], check=True)
                libraries[f"jni/{abi}/{name}"] = packaged.read_bytes()
    original = work / f"moonshine-voice-{MOONSHINE}.aar"
    download(f"https://repo.maven.apache.org/maven2/ai/moonshine/moonshine-voice/{MOONSHINE}/moonshine-voice-{MOONSHINE}.aar",
             original, "65282ac1a1381ee99ecf1190f9059c9ef41684e8afb3fea90db8ca150865b52d")
    artifact = work / f"moonshine-voice-{MOONSHINE}-ort{ORT}.aar"
    with zipfile.ZipFile(original) as old, zipfile.ZipFile(artifact, "w") as new:
        for entry in old.infolist():
            new.writestr(entry, libraries.get(entry.filename, old.read(entry.filename)), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    verify(artifact)
    manifest = {"artifact": artifact.name, "sha256": sha256(artifact), "moonshine": MOONSHINE,
                "onnxruntime": ORT, "ndk": NDK, "sourceTarballSha256": SOURCE_SHA, "onnxAarSha256": ORT_SHA,
                "abis": list(ABIS)}
    artifact.with_suffix(".json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", type=Path)
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--sdk", type=Path, default=Path(os.environ.get("ANDROID_HOME", str(Path.home() / "Android/Sdk"))))
    args = parser.parse_args()
    if args.verify:
        verify(args.verify)
    elif args.work_dir:
        build(args.work_dir.resolve(), args.sdk.resolve())
    else:
        parser.error("Pass --work-dir or --verify")
