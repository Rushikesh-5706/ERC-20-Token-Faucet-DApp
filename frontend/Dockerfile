FROM node:18-alpine AS build

WORKDIR /app

ARG VITE_RPC_URL
ARG VITE_TOKEN_ADDRESS
ARG VITE_FAUCET_ADDRESS
ARG VITE_CHAIN_ID=11155111

ENV VITE_RPC_URL=${VITE_RPC_URL}
ENV VITE_TOKEN_ADDRESS=${VITE_TOKEN_ADDRESS}
ENV VITE_FAUCET_ADDRESS=${VITE_FAUCET_ADDRESS}
ENV VITE_CHAIN_ID=${VITE_CHAIN_ID}

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
