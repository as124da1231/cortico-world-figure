"""Small subprocess adapter for the TTS SDKs installed in the user's Python."""
import asyncio
import contextlib
import json
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit

LIMIT = 12 * 1024 * 1024


async def edge(config, text):
    from edge_tts import Communicate

    speech = Communicate(text, config['voice'], rate=f"{config['rate']:+d}%",
                         volume=f"{config['volume']:+d}%", pitch=f"{config['pitch']:+d}Hz")
    chunks = bytearray()
    async for event in speech.stream():
        if event['type'] == 'audio':
            chunks.extend(event['data'])
            if len(chunks) > LIMIT:
                raise ValueError('Audio limit')
    return chunks


def genie(config, text):
    import genie_tts

    name = config['voice']
    genie_tts.load_character(character_name=name, language=config['language'], onnx_model_dir=config['modelDir'])
    if config['reference']:
        genie_tts.set_reference_audio(character_name=name, audio_path=config['reference'],
                                      audio_text=config['prompt'], language=config['language'])
    with tempfile.TemporaryDirectory(prefix='figure-voice-') as directory:
        path = Path(directory) / 'clip.wav'
        genie_tts.tts(character_name=name, text=text, save_path=str(path))
        with path.open('rb') as source:
            return source.read(LIMIT + 1)


def cosyvoice(config, key, text):
    import dashscope
    from dashscope.audio.tts_v2 import AudioFormat, SpeechSynthesizer

    service = urlsplit(config['endpoint'])
    protocol = 'wss' if service.scheme == 'https' else 'ws'
    dashscope.base_websocket_api_url = f'{protocol}://{service.netloc}/api-ws/v1/inference'
    dashscope.api_key = key
    engine = SpeechSynthesizer(model=config['model'], voice=config['voice'], format=AudioFormat.WAV_24000HZ_MONO_16BIT)
    return engine.call(text, 25000)


def main():
    provider = sys.argv[1]
    value = json.load(sys.stdin.buffer)
    config, text = value['config'], value['text']
    output = sys.stdout.buffer
    with contextlib.redirect_stdout(sys.stderr):
        if provider == 'edge':
            audio = asyncio.run(edge(config, text))
        elif provider == 'genie':
            audio = genie(config, text)
        elif provider == 'dashscope':
            audio = cosyvoice(config, value['key'], text)
        else:
            raise ValueError('Unknown provider')
    if not audio or len(audio) > LIMIT:
        raise ValueError('Invalid audio')
    output.write(audio)


if __name__ == '__main__':
    try:
        main()
    except ImportError:
        sys.exit(10)
    except Exception as error:
        sys.exit(11 if sys.argv[1] == "edge" and getattr(error, "status", None) == 403 else 1)
