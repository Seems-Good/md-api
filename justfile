# No args we list cmds 
default:
  just --list

alias b := build
alias r := backend

# build with cargo 
build:
  cargo build

# run api and web backend.
backend: build
  cargo run --bin r2-storage-api

release: 
  cargo build --release

# Add a user with just add name
add *ARGS: build
  cargo run --bin add_user {{ ARGS }}

# cross compile for raspberry pi
cross:
  cross build --target aarch64-unknown-linux-gnu --release

# packege both binaries into a tarball for pi
pi: cross
  tar czvf pi-pkg.tar ./target/aarch64-unknown-linux-gnu/release/{add_user, r2-storage-api}

# packege both binaries into a tarball
pkg: release
  tar czvf pkg.tar users.json .env -C target/release add_user r2-storage-api 
