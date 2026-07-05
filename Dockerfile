FROM node:20-bookworm-slim

# ffmpeg is required by yt-dlp for audio extraction (--extract-audio --audio-format mp3).
# python3/pip + curl are required to install yt-dlp itself.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

ENV YTDLP_BIN=/usr/local/bin/yt-dlp
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/tmp_audio

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
