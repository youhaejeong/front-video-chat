import React, { useRef } from "react";
import { useWebRTC } from "../hooks/useWebRTC";
import axios from "axios";

const VideoChatRoom = () => {
  const roomId = localStorage.getItem("roomId");
  const username = localStorage.getItem("username");

  const localVideoRef = useRef(null);
  const peerVideoRefs = useRef({});

  const { role, peers, localReady } = useWebRTC(
    roomId,
    localVideoRef,
    peerVideoRefs 
  );

  if (!role) return <p>역할 확인 중...</p>;

  return (
    <div style={{ display: "flex", flexWrap: "wrap" }}>
      <div style={{ width: "100%", marginBottom: "10px" }}>역할: {role}</div>
      <div>접속자 닉네임 :  {username}</div>

      {role === "ROLE_BROADCASTER" && localReady && (
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: 300,
            height: 200,
            border: "2px solid red",
            margin: "5px",
          }}
        />
      )}

      {Object.keys(peers).map((peerName) => (
        <video
          key={peerName}
          ref={(el) => {
            if (el) {
              peerVideoRefs.current[peerName] = el;
              const pending = window.pendingStreams?.current?.[peerName];
              if (pending) {
                el.srcObject = pending;
                el.play().catch(console.error);
                delete window.pendingStreams.current[peerName];
              }
            }
          }}
          autoPlay
          playsInline
          muted={role === "ROLE_VIEWER"}
          style={{
            width: 300,
            height: 200,
            border: "2px solid blue",
            margin: "5px",
          }}
        />
      ))}
    </div>
  );
};

export default VideoChatRoom;
