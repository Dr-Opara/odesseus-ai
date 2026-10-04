import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
        }}
      >
        <div
          style={{
            width: 164,
            height: 164,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderRadius: 46,
            background: "#ff4605",
            color: "#ffffff",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 88,
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          <div style={{position:"absolute",width:72,height:72,borderRadius:999,right:-17,top:-14,background:"#5c1fb8"}} />
          <div style={{position:"absolute",width:66,height:66,borderRadius:999,left:-17,bottom:-20,background:"#0e0e1f"}} />
          <div style={{ position: "relative", zIndex: 2 }}>O</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
