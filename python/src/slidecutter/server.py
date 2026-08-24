"""独立部署的 PPT 构建服务（FastAPI）。

前端把 layout 与切片 PNG（base64）POST 到这里，返回生成好的 .pptx。
启动：uv run slidecutter-server（默认 0.0.0.0:8000，可用 PORT 环境变量覆盖）。
"""

from __future__ import annotations

import base64
import os
from urllib.parse import quote

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel

from .build_ppt import build_pptx_bytes

PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


class Element(BaseModel):
    file: str
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0
    data: str  # base64 编码的 PNG 图片


class LayoutRequest(BaseModel):
    source: str = "slide"
    width: int | None = None
    height: int | None = None
    scale: float = 1.0
    elements: list[Element] = []


app = FastAPI(title="SlideCutter PPT Builder")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _content_disposition(filename: str) -> str:
    """生成 Content-Disposition，兼容中文文件名（RFC 5987 filename*）。"""
    try:
        filename.encode("ascii")
        plain = filename
    except UnicodeEncodeError:
        plain = "slide.pptx"
    return f"attachment; filename=\"{plain}\"; filename*=UTF-8''{quote(filename)}"


@app.post("/api/build-ppt")
def build_ppt(req: LayoutRequest) -> Response:
    if not req.elements:
        raise HTTPException(status_code=400, detail="elements 为空")
    images: dict[str, bytes] = {}
    for el in req.elements:
        try:
            images[el.file] = base64.b64decode(el.data)
        except Exception:
            raise HTTPException(status_code=400, detail=f"图片解码失败：{el.file}")
    layout = {
        "width": req.width,
        "height": req.height,
        "elements": [
            {"file": e.file, "x": e.x, "y": e.y, "width": e.width, "height": e.height}
            for e in req.elements
        ],
    }
    buf = build_pptx_bytes(layout, images, req.scale)
    name = f"{req.source.rsplit('.', 1)[0] or 'slide'}-slide.pptx"
    return Response(
        content=buf.getvalue(),
        media_type=PPTX_MIME,
        headers={"Content-Disposition": _content_disposition(name)},
    )


def run() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
