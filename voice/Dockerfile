FROM python:3.13-slim
RUN pip install --no-cache-dir faster-whisper && apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY stt.py .
ENV STT_HOST=0.0.0.0 STT_PORT=8765
EXPOSE 8765
CMD ["python", "stt.py"]
