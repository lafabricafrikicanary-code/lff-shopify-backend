#!/usr/bin/env bash
set -euo pipefail

MODEL="${1:-llava:7b}"
docker exec lff-ollama ollama pull "${MODEL}"
docker exec lff-ollama ollama list
