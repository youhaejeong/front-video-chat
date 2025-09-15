import { useState, useEffect, useRef } from "react";
import mqtt from "mqtt";

export const useWebRTC = (roomId, localVideoRef, peerVideoRefs) => {
  const [role] = useState(localStorage.getItem("role")); // ROLE_BROADCASTER / ROLE_VIEWER
  const [localReady, setLocalReady] = useState(false);
  const localStream = useRef(null);
  const mqttClient = useRef(null);
  const peerConnections = useRef({});
  const pendingCandidates = useRef({});
  const pendingAnswers = useRef({});
  const pendingStreams = useRef({});
  const [peers, setPeers] = useState({});


  // pendingStreams를 window에도 연결
  window.pendingStreams = pendingStreams;

  const iceServers = [
    { urls: "stun:127.0.0.1:3478" },
    {
      urls: [
        "turn:127.0.0.1:3478?transport=udp",
        "turn:127.0.0.1:3478?transport=tcp",
      ],
      username: "user",
      credential: "pass",
    },
  ];

  // MQTT 연결
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
        `${roomId}/join`,
        `${roomId}/leave`,
        `${roomId}/offer`,
        `${roomId}/answer`,
        `${roomId}/candidate`,
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
                client.publish(`${roomId}/join`, username);
              }
            }
          }
        });
      });

      if (role === "ROLE_BROADCASTER") {
        await initLocalStream();
        joinQueue.forEach((viewer) => sendOffer(viewer));
        joinQueue.length = 0;
      }
    });

    // MQTT 메시지 처리
    client.on("message", async (topic, message) => {
      const msg = message.toString();
      const username = localStorage.getItem("username");

      // Viewer join → Broadcaster가 OFFER 생성
      if (topic === `${roomId}/join` && role === "ROLE_BROADCASTER") {
        const viewer = msg;
        if (viewer === username) return;

        if (!localReady) joinQueue.push(viewer);
        else sendOffer(viewer);
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
        console.log("offer.sender", offer.sender);
        const pc = createPeerConnection(offer.sender);
        console.log(pc);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));

          // RemoteDescription 세팅 후 → pendingCandidates 처리
          if (pendingCandidates.current[offer.sender]?.length) {
            for (const c of pendingCandidates.current[offer.sender]) {
              await pc.addIceCandidate(c);
            }
            pendingCandidates.current[offer.sender] = [];
          }

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

          console.log("Viewer → Answer 전송 완료");
        } catch (err) {
          console.error("VIEWER: OFFER 처리 실패", err);
        }
      }

      // ANSWER 수신 (Broadcaster)
      if (topic === `${roomId}/answer` && role === "ROLE_BROADCASTER") {
        const answer = JSON.parse(msg);
        console.log("aa", answer);
        console.log("peerConnections", peerConnections);
        console.log(
          "peerConnections.current[answer.sender]",
          peerConnections.current[answer.sender]
        );
        const pc = peerConnections.current[answer.sender]?.pc;
        console.log("vv:,", pc);
        if (!pc) {
          console.warn("PC 없음 → pendingAnswers에 저장", answer.sender);
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
        console.log("ICE Candidate", candidateMsg);
        const pc = peerConnections.current[candidateMsg.sender]?.pc;
        console.log("ICE Candidate", pc);
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

    return () => {
      if (role === "ROLE_VIEWER") client.publish(`${roomId}/leave`, username);
      client.end(true);
    };
  }, [roomId, role, localReady]);

  // 로컬 스트림 초기화
  const initLocalStream = async () => {
    try {
      localStream.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false, // 비디오만 전송
      });
      setLocalReady(true);
    } catch (err) {
      console.error("카메라/마이크 접근 실패:", err);
    }
  };

  // BROADCASTER 로컬 비디오 연결
  useEffect(() => {
    if (localReady && localVideoRef.current && localStream.current) {
      localVideoRef.current.srcObject = localStream.current;
      localVideoRef.current
        .play()
        .catch((err) => console.error("play() 실패:", err));
    }
  }, [localReady, localVideoRef]);

  // PeerConnection 생성
  const createPeerConnection = (peerName) => {
    if (peerConnections.current[peerName])
      return peerConnections.current[peerName].pc;

    const pc = new RTCPeerConnection({ iceServers });
    pendingCandidates.current[peerName] = [];

    if (role === "ROLE_BROADCASTER" && localStream.current) {
      localStream.current.getTracks().forEach((track) => {
        if (track.kind === "video") {
          pc.addTrack(track, localStream.current);
        }
      });
    }

    // ontrack → Viewer 화면 연결'
    // ontrack → Viewer 화면 연결
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      setPeers(prev => ({ ...prev, [peerName]: { pc, stream } }));

      const videoEl = peerVideoRefs?.current?.[peerName];
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(console.error);
      } else {
        pendingStreams.current[peerName] = stream;
      }
    };
    // pc.ontrack = (event) => {
    //   const stream = event.streams[0];
    //   if (!stream) return;

    //   setPeers((prev) => {
    //     const newPeers = { ...prev, [peerName]: { pc, stream } };
    //     console.log(newPeers)
    //     const videoEl = peerVideoRefs?.current?.[peerName];
    //     console.log("videoEl",videoEl)
    //     if (videoEl) {
    //       console.warn("videoEl 있음")
    //       if (videoEl.srcObject !== stream) {
    //         videoEl.srcObject = stream;
    //         videoEl.play().catch(console.error);
    //       }
    //     } else {
    //       console.warn("videoEl 아직 없음", peerName, stream);
    //     }

    //     return newPeers;
    //   });
    // };

    // onicecandidate → MQTT 전송
    let candidateCount = 0;
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(
          "Candidate JSON:",
          JSON.stringify(
            {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            },
            null,
            2
          )
        );
        candidateCount++;
        console.log(
          `[${peerName}] ICE Candidate #${candidateCount}`,
          event.candidate
        );

        mqttClient.current.publish(
          `${roomId}/candidate`,
          JSON.stringify({
            sender: localStorage.getItem("username"),
            candidate: event.candidate,
          })
        );
      } else {
        console.log(
          `[${peerName}] ICE Candidate 수집 완료 (총 ${candidateCount}개)`
        );
      }
    };

    pc.onconnectionstatechange = () =>
      console.log("ConnectionState:", peerName, pc.connectionState);
    pc.oniceconnectionstatechange = () =>
      console.log("ICEConnectionState:", peerName, pc.iceConnectionState);

    peerConnections.current[peerName] = { pc };

    // OFFER 생성 직후 pendingAnswer 적용
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

  return { role, peers, localStream, localReady };
};
