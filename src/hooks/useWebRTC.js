import { useEffect, useRef, useState } from "react";
import mqtt from "mqtt";

// WebRTC 커스텀 훅 (MQTT 시그널링 + TURN 서버)
export const useWebRTC = (roomId, username) => {
  const [peers, setPeers] = useState({});           // 다른 참여자 정보
  const localStream = useRef();                     // 내 카메라/마이크 스트림
  const peersRef = useRef({});                      // socketId -> RTCPeerConnection
  const clientRef = useRef();                       // MQTT 클라이언트

  useEffect(() => {
    // 1. MQTT 브로커 연결
    clientRef.current = mqtt.connect("ws://localhost:9001");

    clientRef.current.on("connect", () => {
      console.log("MQTT connected");
      clientRef.current.subscribe(`${roomId}/#`);
    });

    // 2. 로컬 카메라/마이크 접근
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        localStream.current = stream;

        // 3. 룸 참가 메시지 발송
        clientRef.current.publish(`${roomId}/join`, JSON.stringify({ username }));
      })
      .catch(err => console.error("Media error:", err));

    // 4. MQTT 메시지 처리
    clientRef.current.on("message", async (topic, message) => {
      const msg = JSON.parse(message.toString());
      const [_, action, target] = topic.split("/"); // roomId/action/targetUsername

      if (action === "offer" && target === username) {
        handleReceiveOffer(msg);
      } else if (action === "answer" && target === username) {
        handleReceiveAnswer(msg);
      } else if (action === "ice-candidate" && target === username) {
        handleNewICECandidate(msg);
      } else if (action === "join" && msg.username !== username) {
        // 새 참여자가 들어오면 offer 생성
        const pc = createPeer(msg.username);
        peersRef.current[msg.username] = pc;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        clientRef.current.publish(
          `${roomId}/offer/${msg.username}`,
          JSON.stringify({ sdp: offer, from: username })
        );
        setPeers(prev => ({ ...prev, [msg.username]: { pc, stream: null } }));
      }
    });

    return () => {
      clientRef.current.end();
      Object.values(peersRef.current).forEach(pc => pc.close());
    };
  }, [roomId, username]);

  // RTCPeerConnection 생성
  const createPeer = (targetUsername) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:localhost:3478",
          username: "turnuser",        // turnserver.conf 설정
          credential: "turnpassword"
        }
      ]
    });

    // 내 스트림 트랙 추가
    localStream.current?.getTracks().forEach(track => pc.addTrack(track, localStream.current));

    // ICE candidate 이벤트 발생 시 MQTT로 전달
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        clientRef.current.publish(
          `${roomId}/ice-candidate/${targetUsername}`,
          JSON.stringify({ candidate: event.candidate, from: username })
        );
      }
    };

    // 원격 스트림 수신 시 peers 상태 업데이트
    pc.ontrack = (event) => {
      setPeers(prev => ({
        ...prev,
        [targetUsername]: { ...prev[targetUsername], stream: event.streams[0] }
      }));
    };

    return pc;
  };

  const handleReceiveOffer = async ({ sdp, from }) => {
    const pc = createPeer(from);
    peersRef.current[from] = pc;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    clientRef.current.publish(
      `${roomId}/answer/${from}`,
      JSON.stringify({ sdp: answer, from: username })
    );
    setPeers(prev => ({ ...prev, [from]: { pc, stream: null } }));
  };

  const handleReceiveAnswer = async ({ sdp, from }) => {
    const pc = peersRef.current[from];
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  };

  const handleNewICECandidate = async ({ candidate, from }) => {
    const pc = peersRef.current[from];
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  };

  return { localStream, peers };
};
