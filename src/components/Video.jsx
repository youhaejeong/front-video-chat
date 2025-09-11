import React, { useEffect, useRef } from "react";

const Video = ({ stream, isLocal }) => {
  const videoRef = useRef();

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div style={{ margin: "5px" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal} // 내 영상만 muted
        style={{ width: "300px", height: "200px", background: "black" }}
      />
      <div>{isLocal ? "나" : "상대"}</div>
    </div>
  );
};

export default Video;
