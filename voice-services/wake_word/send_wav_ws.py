import asyncio
import websockets
import pathlib

async def send_file(path):
    uri = "ws://localhost:8765"
    async with websockets.connect(uri) as ws:
        print("Connected")
        data = pathlib.Path(path).read_bytes()
        await ws.send(data)  # send binary wav bytes
        resp = await ws.recv()
        print("Response:", resp)

asyncio.run(send_file("hey-navexa-test1.wav"))