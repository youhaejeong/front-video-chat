import React from "react";
import { useWebRTC } from "../hooks/useWebRTC";
import Video from "../components/Video";

const VideoChatRoom = ({ roomId, username }) => {
  const { localStream, peers } = useWebRTC(roomId, username);
  const safePeers = peers || {};

  return (
    <div style={{ display: "flex", flexWrap: "wrap" }}>
      {/* 내 화면 */}
      {localStream.current && <Video stream={localStream.current} isLocal={true} />}

      {/* 다른 참여자 화면 */}
      {Object.entries(safePeers).map(([user, { stream }]) =>
        stream ? <Video key={user} stream={stream} isLocal={false} /> : null
      )}
    </div>
  );
};

export default VideoChatRoom;
