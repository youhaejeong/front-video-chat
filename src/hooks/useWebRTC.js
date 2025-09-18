import { useState, useEffect, useRef } from "react";
import mqtt from "mqtt";

export const useWebRTC = (roomId, localVideoRef, peerVideoRefs) => {
  const [role] = useState(localStorage.getItem("role")); // ROLE_BROADCASTER / ROLE_VIEWER
  const [localReady, setLocalReady] = useState(false);
  const localStream = useRef(null); // MediaStream: 카메라/마이크 스트림 저장
  const mqttClient = useRef(null); // Signaling Server 역할: MQTT 브로커 사용
  const peerConnections = useRef({}); // RTCPeerConnection 객체 저장
  const pendingCandidates = useRef({}); // ICE Candidate 임시 저장
  const pendingAnswers = useRef({}); // Session Description(ANSWER) 임시 저장
  const pendingStreams = useRef({}); // ontrack 이벤트 전 MediaStream 임시 저장
  const [peers, setPeers] = useState({}); // 연결된 Peer와 스트림 정보 저장

  window.pendingStreams = pendingStreams;

  const iceServers = [
    { urls: "stun:127.0.0.1:3478" }, // STUN 서버: NAT Traversal 지원
    {
      urls: [
        "turn:127.0.0.1:3478?transport=udp",
        "turn:127.0.0.1:3478?transport=tcp",
      ],
      username: "user",
      credential: "pass",
    }, // TURN 서버: NAT Traversal + Relay 지원
  ];

  // MQTT 연결 (Signaling Server 역할)
  useEffect(() => {
    if (!roomId || !role) return;

    if (mqttClient.current) {
      mqttClient.current.end(true);
      mqttClient.current = null;
    }

    const username = localStorage.getItem("username");
    mqttClient.current = mqtt.connect("ws://localhost:9001", {
      clientId: username + "_" + Date.now(),
      reconnectPeriod: 1000,
    });

    const client = mqttClient.current;
    const joinQueue = [];

    client.on("connect", async () => {
      console.log("MQTT connected as", role, "username:", username);

      const topics = [
        `${roomId}/join`,      // Signaling: Peer Join 알림
        `${roomId}/leave`,     // Signaling: Peer Leave 알림
        `${roomId}/offer`,     // Signaling: Session Description(OFFER)
        `${roomId}/answer`,    // Signaling: Session Description(ANSWER)
        `${roomId}/candidate`, // Signaling: ICE Candidate 교환
      ];

      let subscribeCount = 0;
      topics.forEach((topic) => {
        client.subscribe(topic, (err) => {
          if (err) console.error("subscribe 실패:", topic, err);
          else {
            subscribeCount++;
            if (subscribeCount === topics.length) {
              console.log("모든 subscribe 완료");
              if (role === "ROLE_VIEWER") {
                client.publish(`${roomId}/join`, username); // Signaling: Viewer Join 전송
              }
            }
          }
        });
      });

      if (role === "ROLE_BROADCASTER") {
        await initLocalStream(); // MediaStream 준비
        joinQueue.forEach((viewer) => sendOffer(viewer)); // Session Description(OFFER) 전송
        joinQueue.length = 0;
      }
    });

    // MQTT 메시지 처리 (Signaling 역할)
    client.on("message", async (topic, message) => {
      const msg = message.toString();
      const username = localStorage.getItem("username");

      // Viewer join → Broadcaster가 OFFER 생성
      if (topic === `${roomId}/join` && role === "ROLE_BROADCASTER") {
        const viewer = msg;
        if (viewer === username) return;

        if (!localReady) joinQueue.push(viewer);
        else sendOffer(viewer); // Session Description(OFFER) 전송
      }

      // Viewer leave
      if (topic === `${roomId}/leave`) {
        const leaver = msg;
        if (peers[leaver]) {
          peerConnections.current[leaver]?.pc.close(); // RTCPeerConnection 종료
          delete peerConnections.current[leaver];
          delete pendingCandidates.current[leaver]; // ICE Candidate 정리
          delete pendingAnswers.current[leaver];    // Session Description 정리
          setPeers((prev) => {
            const updated = { ...prev };
            delete updated[leaver];
            return updated;
          });
        }
      }

      // OFFER 수신 (Viewer)
      if (topic === `${roomId}/offer` && role === "ROLE_VIEWER") {
        const offer = JSON.parse(msg);
        if (offer.target !== username) return;
        const pc = createPeerConnection(offer.sender); // RTCPeerConnection 생성
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp)); // Session Description(OFFER) 적용

          // RemoteDescription 세팅 후 → ICE Candidate 처리
          if (pendingCandidates.current[offer.sender]?.length) {
            for (const c of pendingCandidates.current[offer.sender]) {
              await pc.addIceCandidate(c); // ICE Candidate 추가
            }
            pendingCandidates.current[offer.sender] = [];
          }

          const answer = await pc.createAnswer(); // Session Description(ANSWER) 생성
          await pc.setLocalDescription(answer);

          client.publish(
            `${roomId}/answer`,
            JSON.stringify({
              sender: username,
              target: offer.sender,
              sdp: answer, // Session Description(ANSWER) 전송
            })
          );

        } catch (err) {
          console.error("VIEWER: OFFER 처리 실패", err);
        }
      }

      // ANSWER 수신 (Broadcaster)
      if (topic === `${roomId}/answer` && role === "ROLE_BROADCASTER") {
        const answer = JSON.parse(msg);
        const pc = peerConnections.current[answer.sender]?.pc;
        if (!pc) {
          pendingAnswers.current[answer.sender] = answer.sdp; // Session Description 임시 저장
          return;
        }

        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer.sdp)); // Session Description(ANSWER) 적용

          if (pendingCandidates.current[answer.sender]?.length) {
            for (const c of pendingCandidates.current[answer.sender]) {
              await pc.addIceCandidate(c); // ICE Candidate 추가
            }
            pendingCandidates.current[answer.sender] = [];
          }
        } catch (err) {
          console.error("setRemoteDescription 실패:", err);
        }
      }

      // ICE Candidate 처리
      if (topic === `${roomId}/candidate`) {
        const candidateMsg = JSON.parse(msg);
        if (candidateMsg.target !== username) return; // 본인 영상만 처리
        const pc = peerConnections.current[candidateMsg.sender]?.pc;
        if (!candidateMsg.candidate) return;

        const rtcCandidate = new RTCIceCandidate(candidateMsg.candidate); // ICE Candidate 생성
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(rtcCandidate); // RTCPeerConnection에 Candidate 추가
        } else {
          if (!pendingCandidates.current[candidateMsg.sender])
            pendingCandidates.current[candidateMsg.sender] = [];
          pendingCandidates.current[candidateMsg.sender].push(rtcCandidate); // ICE Candidate 임시 저장
        }
      }
    });

    return () => {
      if (role === "ROLE_VIEWER") client.publish(`${roomId}/leave`, username); // Signaling: Viewer Leave 전송
      client.end(true); // MQTT 연결 종료
    };
  }, [roomId, role, localReady]);

  // 로컬 MediaStream 초기화
  const initLocalStream = async () => {
    try {
      localStream.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false, // MediaStream: Video 전송
      });
      setLocalReady(true);
    } catch (err) {
      console.error("카메라/마이크 접근 실패:", err);
    }
  };

  // 로컬 비디오 연결
  useEffect(() => {
    if (localReady && localVideoRef.current && localStream.current) {
      localVideoRef.current.srcObject = localStream.current; // MediaStream 연결
      localVideoRef.current.play().catch((err) => console.error("play() 실패:", err));
    }
  }, [localReady, localVideoRef]);

  // RTCPeerConnection 생성
  const createPeerConnection = (peerName) => {
    if (peerConnections.current[peerName])
      return peerConnections.current[peerName].pc;

    const pc = new RTCPeerConnection({ iceServers }); // RTCPeerConnection 생성
    pendingCandidates.current[peerName] = [];

    if (role === "ROLE_BROADCASTER" && localStream.current) {
      localStream.current.getTracks().forEach((track) => {
        if (track.kind === "video") {
          pc.addTrack(track.clone(), localStream.current); // MediaStream Track 복제 추가
        }
      });
    }

    // ontrack → Viewer 화면 연결
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      setPeers((prev) => ({ ...prev, [peerName]: { pc, stream } })); // Peer 저장

      const videoEl = peerVideoRefs?.current?.[peerName];
      if (videoEl) {
        videoEl.srcObject = stream; // MediaStream 연결
        videoEl.play().catch(console.error);
      } else {
        pendingStreams.current[peerName] = stream; // ontrack 전 임시 저장
      }
    };

    // onicecandidate → MQTT 전송 (Signaling)
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        mqttClient.current.publish(
          `${roomId}/candidate`,
          JSON.stringify({
            sender: localStorage.getItem("username"),
            target: peerName, // viewer가 여러명 생길수있게 추가
            candidate: event.candidate, // ICE Candidate 전송
          })
        );
      }
    };

    pc.onconnectionstatechange = () =>
      console.log("ConnectionState:", peerName, pc.connectionState);
    pc.oniceconnectionstatechange = () =>
      console.log("ICEConnectionState:", peerName, pc.iceConnectionState);

    peerConnections.current[peerName] = { pc }; // PeerConnection 저장

    // OFFER 생성 직후 pendingAnswer 적용
    if (pendingAnswers.current[peerName]) {
      pc.setRemoteDescription(
        new RTCSessionDescription(pendingAnswers.current[peerName]) // Session Description 적용
      )
        .then(() => {
          console.log("Pending ANSWER 적용 완료:", peerName);
          delete pendingAnswers.current[peerName]; // 임시 ANSWER 제거
        })
        .catch(console.error);
    }

    return pc; // RTCPeerConnection 반환
  };

  // OFFER 전송 (Broadcaster)
  const sendOffer = async (peerName) => {
    const pc = createPeerConnection(peerName);
    const offer = await pc.createOffer(); // Session Description(OFFER) 생성
    await pc.setLocalDescription(offer);  // LocalDescription 설정

    mqttClient.current.publish(
      `${roomId}/offer`,
      JSON.stringify({
        sender: localStorage.getItem("username"),
        target: peerName,
        sdp: offer, // Session Description(OFFER) 전송
      })
    );
  };

  return { role, peers, localStream, localReady }; // 훅 반환값
};
