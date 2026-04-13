# ShotStream daemon — CUDA 12.4 + PyTorch 2.8 + flash-attn.
# Build is slow (~10–20 min) because flash-attn compiles from source.
#
# Build:    docker compose build
# Weights:  mounted via volume (see docker-compose.yml) — not baked in.
# Run:      docker compose up

FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/workspace/.cache/huggingface \
    TORCH_HOME=/workspace/.cache/torch

# Base tooling + Python 3.10 + ffmpeg (torchvision.io.write_video needs it).
RUN apt-get update && apt-get install -y --no-install-recommends \
        git git-lfs curl ca-certificates build-essential ninja-build \
        python3.10 python3.10-dev python3.10-venv python3-pip \
        ffmpeg libgl1 libglib2.0-0 \
    && git lfs install \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1 \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.10 1 \
    && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip setuptools wheel

# Torch 2.8.0 with CUDA 12.8 wheels (upstream-recommended in ShotStream's env.sh).
RUN pip install torch==2.8.0 torchvision==0.23.0 \
        --index-url https://download.pytorch.org/whl/cu128

# Clone upstream ShotStream and install its requirements.
WORKDIR /workspace
ARG SHOTSTREAM_REF=main
RUN git clone --depth 1 --branch ${SHOTSTREAM_REF} \
        https://github.com/KlingAIResearch/ShotStream.git /workspace/ShotStream \
 && pip install -r /workspace/ShotStream/requirements.txt

# flash-attn needs the CUDA toolkit at build time — nvcc ships in the -devel
# image. --no-build-isolation matches upstream env.sh.
RUN MAX_JOBS=4 pip install flash-attn==2.7.4.post1 --no-build-isolation || \
    pip install flash-attn --no-build-isolation

# Daemon code.
COPY requirements.txt /workspace/daemon/requirements.txt
RUN pip install -r /workspace/daemon/requirements.txt

COPY app /workspace/daemon/app
COPY scripts/entrypoint.sh /workspace/entrypoint.sh
RUN chmod +x /workspace/entrypoint.sh

# Expected mounts (weights live OUTSIDE the image):
#   -v D:\shotstream\ckpts:/workspace/ckpts
#   -v D:\shotstream\wan_models:/workspace/wan_models
#   -v D:\shotstream\outputs:/workspace/outputs

ENV SHOTSTREAM_REPO=/workspace/ShotStream \
    SHOTSTREAM_CONFIG=/workspace/ckpts/shotstream.yaml \
    SHOTSTREAM_CKPT=/workspace/ckpts/shotstream_merged.pt \
    SHOTSTREAM_OUTPUT_ROOT=/workspace/outputs \
    SHOTSTREAM_WORK_ROOT=/workspace/work \
    SHOTSTREAM_PUBLIC_URL=http://127.0.0.1:9100 \
    SHOTSTREAM_PRELOAD=false \
    PYTHONPATH=/workspace/daemon

EXPOSE 9100
ENTRYPOINT ["/workspace/entrypoint.sh"]
