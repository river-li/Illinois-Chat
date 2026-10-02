"""Official NLIP SDK/server interoperability fixture; no live weather or LLM.

Run: python weather_agent.py --port 18081
This is intentionally deterministic: it supplies knowledge absent from the
Illinois Chat course slide fixture so delegation is visible and repeatable.
"""
import argparse
import json
import tempfile
from pathlib import Path

import uvicorn
from fastapi.responses import FileResponse, JSONResponse
from nlip_sdk.nlip import NLIP_Factory, NLIP_Message
from nlip_server.server import NLIP_Application, NLIP_Session, setup_server


class WeatherSession(NLIP_Session):

    async def execute(self, message: NLIP_Message) -> NLIP_Message:
        question = message.extract_text(language=None)
        if not question or "champaign" not in question.lower():
            return NLIP_Message(format="error",
                                subformat="text",
                                content="Ask about Champaign")
        response = NLIP_Factory.create_text(
            "Demo forecast for Champaign: 14 C, rain. Bring a raincoat. "
            "This is a fixed test forecast, not current weather.")
        response.add_json(
            {
                "city": "Champaign",
                "temperature_c": 14,
                "rain": True
            },
            label="weather")
        return response


class WeatherApplication(NLIP_Application):

    async def startup(self):
        pass

    async def shutdown(self):
        pass

    def create_session(self):
        return WeatherSession()


app = setup_server(WeatherApplication())


@app.get("/demo", include_in_schema=False)
def demo_page():
    """Local protocol console, separate from the Illinois Chat application UI."""
    return FileResponse(Path(__file__).with_name("demo.html"))


@app.get("/demo/trace", include_in_schema=False)
def demo_trace():
    # Fixed path; callers cannot select arbitrary local files. The integration
    # runner writes only fixture data and omits authentication headers.
    trace_file = Path(tempfile.gettempdir()) / "illinois-nlip-demo-result.json"
    if not trace_file.exists():
        return JSONResponse(
            {
                "error":
                "Run scripts/nlip-demo/run.sh first to generate the Agent Mode trace."
            },
            status_code=404)
    data = json.loads(trace_file.read_text())
    return {
        key: data.get(key)
        for key in ("runAt", "fixtures", "real", "tools", "finalAnswer",
                    "sdkValidation")
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18081)
    args = parser.parse_args()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
