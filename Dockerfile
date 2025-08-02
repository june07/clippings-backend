FROM node:current

ENV NODE_ENV production
ENV TZ="America/Los_Angeles"

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl \
        gnupg \
        ca-certificates \
        lsb-release \
        dumb-init && \
    apt-get update && \
    apt-get install -y --no-install-recommends xvfb x11vnc x11-utils xauth websockify && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/src/node-app && chown -R node:node /usr/src/node-app

WORKDIR /usr/src/node-app

COPY package.json ./

RUN chown -R node:node .

USER node

COPY --chown=node:node . .

USER root

RUN npm ci \
    && npx playwright install chromium \
    && npx playwright install-deps chromium

USER node

EXPOSE 3000

CMD ["dumb-init", "node", "server.js"]
