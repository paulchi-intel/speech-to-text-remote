# Speech-to-Text Remote — Qwen3-ASR backend for Intel GPUs (XPU)
FROM ubuntu:24.04

ARG http_proxy
ARG https_proxy
ARG no_proxy
ENV DEBIAN_FRONTEND=noninteractive

# Intel GPU user-space runtime (Level Zero + OpenCL) for Battlemage, plus ffmpeg
# to decode whatever the browser uploads (webm/ogg/mp3/m4a/wav)
RUN apt-get update \
 && apt-get install -y --no-install-recommends software-properties-common gpg-agent ca-certificates \
 && add-apt-repository -y ppa:kobuk-team/intel-graphics \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      libze1 libze-intel-gpu1 intel-opencl-icd clinfo \
      python3 python3-venv python3-pip \
      sox libsox-fmt-all libsndfile1 ffmpeg \
 && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# PyTorch XPU first, in its own layer, so qwen-asr's dependencies never pull a CUDA build
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/xpu

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY asr_server.py /app/asr_server.py

ENV HF_HOME=/models \
    ASR_MODEL_ID=Qwen/Qwen3-ASR-1.7B \
    ASR_PORT=17495 \
    PYTHONUNBUFFERED=1

WORKDIR /app
EXPOSE 17495
CMD ["python", "asr_server.py"]
