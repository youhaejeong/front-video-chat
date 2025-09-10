import { useState, useRef, useEffect, useCallback } from "react";
import mqtt from "mqtt";

/**
 * useWebRTC 훅
 * - roomId: 방 고유 ID
 * - userId: 사용자 고유 ID
 * - turnConfig: TURN 서버 정보 { urls, username, credential }
 */
export const useWebRTC = (roomId, userId, turnConfig) => {
  const [remoteStreams, setRemoteStreams] = useState([]);
  const localAudioRef = useRef(null);
  const pcRef = useRef(null);
  const clientRef = useRef(null);

  // 방 입장 시 offer 생성
  const createOffer = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    clientRef.current.publish(
      `${roomId}/signal`,
      JSON.stringify({ type: "offer", from: userId, sdp: offer })
    );
  }, [roomId, userId]);

  useEffect(() => {
    // MQTT 연결
    const client = mqtt.connect("ws://localhost:9001");
    clientRef.current = client;

    // RTCPeerConnection 생성
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        turnConfig
      ]
    });
    pcRef.current = pc;

    // 로컬 오디오 가져오기 (오디오 전용)
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        if (localAudioRef.current) {
          localAudioRef.current.srcObject = stream;
        }
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
      })
      .catch(err => {
        if (err.name === "NotFoundError") {
          alert("마이크 장치를 찾을 수 없습니다. 연결 후 다시 시도해주세요.");
        } else {
          console.error("Audio error: ", err);
        }
      });

    // 원격 오디오 스트림 수신
    pc.ontrack = (event) => {
      setRemoteStreams(prev => [...prev, event.streams[0]]);
    };

    // ICE candidate 발생 시 MQTT 전송
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        client.publish(`${roomId}/signal`, JSON.stringify({
          type: "candidate",
          from: userId,
          candidate: event.candidate
        }));
      }
    };

    // MQTT 메시지 수신 처리
    client.subscribe(`${roomId}/signal`);
    client.on("message", async (topic, message) => {
      const data = JSON.parse(message.toString());
      if (data.from === userId) return;

      try {
        if (data.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          client.publish(`${roomId}/signal`, JSON.stringify({
            type: "answer",
            from: userId,
            sdp: answer
          }));
        } else if (data.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        } else if (data.type === "candidate") {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error("WebRTC signaling error:", err);
      }
    });

    // 클린업
    return () => {
      client.end();
      pc.close();
    };
  }, [roomId, userId, turnConfig]);

  return { localAudioRef, remoteStreams, createOffer };
};
