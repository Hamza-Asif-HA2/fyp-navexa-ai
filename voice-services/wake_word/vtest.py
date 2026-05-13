import asyncio, websockets, json

async def send_wav(path):
    uri = "ws://localhost:8765"
    async with websockets.connect(uri) as ws:
        with open(path, "rb") as f:
            data = f.read()
        await ws.send(data)
        resp = await ws.recv()
        print("Response:", json.loads(resp))

asyncio.run(send_wav("hey-navexa-test1.wav"))