import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            borderRadius: 16,
            background: "#ff4605",
            color: "#ffffff",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 30,
            fontWeight: 900,
            lineHeight: 1,
          }}
        >
          <div style={{position:"absolute",width:25,height:25,borderRadius:999,right:-6,top:-5,background:"#5c1fb8"}} />
          <div style={{position:"absolute",width:23,height:23,borderRadius:999,left:-6,bottom:-7,background:"#0e0e1f"}} />
          <div style={{ position: "relative", zIndex: 2 }}>O</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
