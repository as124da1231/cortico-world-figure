# Coo figure preview frame

Adapted from the figure-frame.js served by the local Coopanion 0.2.17 desktop-pet World on 2026-11-01. Upstream: https://github.com/Pal-AI-Lab/Coopanion/tree/main/packages/cortico-world-desktop-pet/web

Original SHA-256: b90276c5ac811dc4bc54832b1c21c6a458b667293304e8bc35a1883e60204cd5

AGPL-3.0-or-later with the upstream Steamworks additional permission; see LICENSE. The license was verified against Coopanion commit 00f0f103c70e4f77a0a260606020eb093c6880fc on 2026-11-03. Original attribution and body contract comments are preserved. Changes: pass the preview option to the generated body, add preview-play/preview-stop and preview-wardrobe messages, and report bounded preview state/quality after a rendered tick. i18n.js is a local minimal adapter. The parent drives init/tick/ready/error using the same protocol, with a timeout and cleanup. This frame does not call the desktop-pet API or write wardrobe settings.
