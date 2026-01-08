FROM debian:trixie-slim

RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*


WORKDIR /app

COPY pkg.tar ./
COPY static ./static

RUN tar xzvf pkg.tar

# Server port
EXPOSE 3000

# Run server
CMD ["./r2-storage-api"]
