import { useState, useEffect, useRef } from "react";
import mqtt from "mqtt";

export const useWebRTC = (roomId, localVideoRef, peerVideoRefs) => {
  // 사용자의 역할: ROLE_BROADCASTER / ROLE_VIEWER
  const [role, setRole] = useState(localStorage.getItem("role"));

  useEffect(() => {
    setRole(localStorage.getItem("role")); // 방 생성/입장 후 role 상태 갱신
  }, [roomId]);

  // 로컬 미디어 스트림 준비 여부
  const [localReady, setLocalReady] = useState(false);

  // 로컬 카메라/마이크 스트림 저장
  const localStream = useRef(null);

  // MQTT 브로커 클라이언트 저장 (Signaling 용)
  const mqttClient = useRef(null);

  // RTCPeerConnection 객체 저장 (peerName 기준)
  const peerConnections = useRef({});

  // ICE Candidate 임시 저장 (상대방 RemoteDescription 전에 수신된 후보)
  const pendingCandidates = useRef({});

  // ANSWER 임시 저장 (상대방 Offer에 대한 응답 전에 수신된 경우)
  const pendingAnswers = useRef({});

  // ontrack 이벤트 전 MediaStream 임시 저장
  const pendingStreams = useRef({});

  // 연결된 peer와 스트림 정보 저장
  const [peers, setPeers] = useState({});

  // 전역에서 pendingStreams 확인 가능하게 설정 (디버깅용)
  window.pendingStreams = pendingStreams;

  // ICE 서버 설정 (STUN/TURN)
  const iceServers = [
    { urls: "stun:127.0.0.1:3478" }, // NAT traversal 지원
    {
      urls: [
        "turn:127.0.0.1:3478?transport=udp",
        "turn:127.0.0.1:3478?transport=tcp",
      ],
      username: "user",
      credential: "pass",
    },
  ];

  // MQTT 연결 및 signaling 처리
  useEffect(() => {
    if (!roomId || !role) return;

    // 기존 연결 종료
    if (mqttClient.current) {
      mqttClient.current.end(true);
      mqttClient.current = null;
    }

    const username = localStorage.getItem("username");
    mqttClient.current = mqtt.connect("ws://localhost:9001", {
      clientId: username + "_" + Date.now(),
      reconnectPeriod: 1000, // 연결 끊기면 1초 후 재연결
    });

    const client = mqttClient.current;
    const joinQueue = []; // localStream 준비 전 viewer join 대기 큐

    // MQTT 연결 완료 시
    client.on("connect", async () => {
      console.log("MQTT connected as", role, "username:", username);

      const topics = [
        `${roomId}/join`, // Viewer join 알림
        `${roomId}/leave`, // Peer leave 알림
        `${roomId}/offer`, // OFFER 수신
        `${roomId}/answer`, // ANSWER 수신
        `${roomId}/candidate`, // ICE candidate 수신
      ];

      // 모든 topic 구독
      let subscribeCount = 0;
      topics.forEach((topic) => {
        client.subscribe(topic, (err) => {
          if (err) console.error("subscribe 실패:", topic, err);
          else {
            subscribeCount++;
            if (subscribeCount === topics.length) {
              console.log("모든 subscribe 완료");
              // Viewer는 join 이벤트 발송
              if (role === "ROLE_VIEWER") {
                client.publish(`${roomId}/join`, username);
              }
            }
          }
        });
      });

      // Broadcaster는 로컬 스트림 준비 후 대기 큐 처리
      if (role === "ROLE_BROADCASTER") {
        await initLocalStream(); // MediaStream 준비
        joinQueue.forEach((viewer) => sendOffer(viewer)); // Offer 전송
        joinQueue.length = 0;
      }
    });

    // MQTT 메시지 처리 (Signaling)
    client.on("message", async (topic, message) => {
      const msg = message.toString();
      const username = localStorage.getItem("username");

      // Viewer join → Broadcaster가 OFFER 생성
      if (topic === `${roomId}/join` && role === "ROLE_BROADCASTER") {
        const viewer = msg;
        if (viewer === username) return;

        if (!localReady) joinQueue.push(viewer); // 스트림 준비 전 대기
        else sendOffer(viewer); // Offer 전송
      }

      // Viewer leave
      if (topic === `${roomId}/leave`) {
        const leaver = msg;
        if (peers[leaver]) {
          peerConnections.current[leaver]?.pc.close();
          delete peerConnections.current[leaver];
          delete pendingCandidates.current[leaver];
          delete pendingAnswers.current[leaver];
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

        const pc = createPeerConnection(offer.sender);
        try {
          // RemoteDescription 세팅
          await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));

          // pending candidate 적용
          if (pendingCandidates.current[offer.sender]?.length) {
            for (const c of pendingCandidates.current[offer.sender]) {
              await pc.addIceCandidate(c);
            }
            pendingCandidates.current[offer.sender] = [];
          }

          // ANSWER 생성 후 MQTT 전송
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          client.publish(
            `${roomId}/answer`,
            JSON.stringify({
              sender: username,
              target: offer.sender,
              sdp: answer,
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
          pendingAnswers.current[answer.sender] = answer.sdp;
          return;
        }

        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer.sdp));

          if (pendingCandidates.current[answer.sender]?.length) {
            for (const c of pendingCandidates.current[answer.sender]) {
              await pc.addIceCandidate(c);
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
        const pc = peerConnections.current[candidateMsg.sender]?.pc;
        if (!candidateMsg.candidate) return;

        const rtcCandidate = new RTCIceCandidate(candidateMsg.candidate);
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(rtcCandidate);
        } else {
          if (!pendingCandidates.current[candidateMsg.sender])
            pendingCandidates.current[candidateMsg.sender] = [];
          pendingCandidates.current[candidateMsg.sender].push(rtcCandidate);
        }
      }
    });

    // 컴포넌트 언마운트 시 정리
    return () => {
      if (role === "ROLE_VIEWER") client.publish(`${roomId}/leave`, username);
      client.end(true);
    };
  }, [roomId, role, localReady]);

  // 로컬 MediaStream 초기화
  const initLocalStream = async () => {
    try {
      localStream.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      setLocalReady(true);
    } catch (err) {
      console.error("카메라/마이크 접근 실패:", err);
    }
  };

  // 로컬 비디오 연결
  useEffect(() => {
    if (localReady && localVideoRef.current && localStream.current) {
      localVideoRef.current.srcObject = localStream.current;
      localVideoRef.current
        .play()
        .catch((err) => console.error("play() 실패:", err));
    }
  }, [localReady, localVideoRef]);

  // RTCPeerConnection 생성
  const createPeerConnection = (peerName) => {
    if (peerConnections.current[peerName])
      return peerConnections.current[peerName].pc;

    const pc = new RTCPeerConnection({ iceServers });
    pendingCandidates.current[peerName] = [];

    // Broadcaster는 로컬 트랙 추가
    if (role === "ROLE_BROADCASTER" && localStream.current) {
      localStream.current.getTracks().forEach((track) => {
        if (track.kind === "video") {
          pc.addTrack(track, localStream.current);
        }
      });
    }

    // Viewer 화면 연결
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      setPeers((prev) => ({ ...prev, [peerName]: { pc, stream } }));

      const videoEl = peerVideoRefs?.current?.[peerName];
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(console.error);
      } else {
        pendingStreams.current[peerName] = stream;
      }
    };

    // ICE Candidate 발생 시 MQTT로 전송
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        mqttClient.current.publish(
          `${roomId}/candidate`,
          JSON.stringify({
            sender: localStorage.getItem("username"),
            candidate: event.candidate,
          })
        );
      }
    };

    pc.onconnectionstatechange = () =>
      console.log("ConnectionState:", peerName, pc.connectionState);
    pc.oniceconnectionstatechange = () =>
      console.log("ICEConnectionState:", peerName, pc.iceConnectionState);

    peerConnections.current[peerName] = { pc };

    // pending ANSWER 적용
    if (pendingAnswers.current[peerName]) {
      pc.setRemoteDescription(
        new RTCSessionDescription(pendingAnswers.current[peerName])
      )
        .then(() => {
          console.log("Pending ANSWER 적용 완료:", peerName);
          delete pendingAnswers.current[peerName];
        })
        .catch(console.error);
    }

    return pc;
  };

  // OFFER 전송 (Broadcaster)
  const sendOffer = async (peerName) => {
    const pc = createPeerConnection(peerName);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    mqttClient.current.publish(
      `${roomId}/offer`,
      JSON.stringify({
        sender: localStorage.getItem("username"),
        target: peerName,
        sdp: offer,
      })
    );
  };

  const cleanup = () => {
    console.log("cleanup 실행");

    // PeerConnection 닫기
    Object.values(peerConnections.current).forEach((pcObj) => pcObj.pc.close());
    peerConnections.current = {};

    // 로컬 스트림 정리
    if (localStream.current) {
      localStream.current.getTracks().forEach((track) => track.stop());
      localStream.current = null;
    }

    // 로컬 비디오 요소 srcObject 해제
    if (localVideoRef?.current) {
      // ?. 추가
      localVideoRef.current.srcObject = null;
    }

    // 피어 비디오 요소 srcObject 해제
    if (peerVideoRefs?.current) {
      Object.values(peerVideoRefs.current).forEach((video) => {
        if (video) video.srcObject = null;
      });
    }

    // pending 객체 초기화
    pendingCandidates.current = {};
    pendingAnswers.current = {};
    pendingStreams.current = {};
  };

  // 컴포넌트 언마운트 시 자동 cleanup 실행
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  return { role, peers, localStream, localReady, cleanup, mqttClient };
};
