# Coo figure preview frame

Adapted from the figure-frame.js served by the local Coopanion 0.2.17 desktop-pet World on 2026-11-01. Upstream: https://github.com/Pal-AI-Lab/Coopanion/tree/main/packages/cortico-world-desktop-pet/web

Original SHA-256: b90276c5ac811dc4bc54832b1c21c6a458b667293304e8bc35a1883e60204cd5

AGPL-3.0-or-later; see LICENSE. Original attribution and body contract comments are preserved. Changes: pass the preview option to the generated body, and add preview-play/preview-stop messages. i18n.js is a local minimal adapter. The parent drives init/tick/ready/error using the same protocol, with a timeout and cleanup. No desktop-pet API or wardrobe writes are made.
