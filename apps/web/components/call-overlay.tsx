'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Lock,
  UserPlus,
  Video,
  VideoOff,
} from 'lucide-react';
import { Button } from '@vault/ui';
import type { ICEServer } from '@vault/types';

export type CallState =
  | { phase: 'idle' }
  | {
      phase: 'incoming';
      callType: 'audio' | 'video';
      dealRoomId: string;
      fromUserId: string;
      fromPseudonym: string;
      callLogId?: string;
    }
  | {
      phase: 'outgoing';
      callType: 'audio' | 'video';
      dealRoomId: string;
      toUserId: string;
      toPseudonym: string;
      callLogId?: string;
    }
  | {
      phase: 'active';
      callType: 'audio' | 'video';
      dealRoomId: string;
      peerUserId: string;
      peerPseudonym: string;
      callLogId?: string;
    };

interface CallOverlayProps {
  callState: CallState;
  socket: Socket | null;
  iceServers: ICEServer[];
  myPseudonym: string;
  onCallEnd: () => void;
}

export function CallOverlay({
  callState,
  socket,
  iceServers,
  myPseudonym,
  onCallEnd,
}: CallOverlayProps) {
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [ringtoneActive, setRingtoneActive] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  const isVisible = callState.phase !== 'idle';

  const cleanupCall = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setDurationSec(0);
    setMuted(false);
    setCameraOff(false);
    setScreenSharing(false);
  }, []);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setDurationSec((s) => s + 1), 1000);
  }, []);

  const stopRingtone = useCallback(() => {
    ringtoneRef.current?.pause();
    setRingtoneActive(false);
  }, []);

  const setupPeerConnection = useCallback(
    (peerUserId: string, dealRoomId: string) => {
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socket?.emit('call:ice-candidate', {
            candidate: JSON.stringify(e.candidate),
            toUserId: peerUserId,
          });
        }
      };

      pc.ontrack = (e) => {
        if (remoteVideoRef.current && e.streams[0]) {
          remoteVideoRef.current.srcObject = e.streams[0];
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') startTimer();
        if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          handleEndCall();
        }
      };

      return pc;
    },
    [iceServers, socket, startTimer],
  );

  const getLocalStream = useCallback(
    async (callType: 'audio' | 'video') => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video',
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    },
    [],
  );

  async function initiateOutgoingCall() {
    if (callState.phase !== 'outgoing') return;
    const pc = setupPeerConnection(callState.toUserId, callState.dealRoomId);
    const stream = await getLocalStream(callState.callType);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket?.emit('call:offer', { sdp: JSON.stringify(offer), toUserId: callState.toUserId });
  }

  async function acceptIncomingCall() {
    if (callState.phase !== 'incoming') return;
    stopRingtone();
    const pc = setupPeerConnection(callState.fromUserId, callState.dealRoomId);
    const stream = await getLocalStream(callState.callType);
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    socket?.emit('call:answer', {
      sdp: JSON.stringify(await pc.createOffer()),
      toUserId: callState.fromUserId,
    });
  }

  function rejectIncomingCall() {
    if (callState.phase !== 'incoming') return;
    stopRingtone();
    socket?.emit('call:reject', { toUserId: callState.fromUserId });
    onCallEnd();
  }

  function handleEndCall() {
    const dealRoomId =
      callState.phase === 'active' || callState.phase === 'outgoing' || callState.phase === 'incoming'
        ? callState.dealRoomId
        : '';
    const callLogId =
      callState.phase === 'active' || callState.phase === 'outgoing' || callState.phase === 'incoming'
        ? callState.callLogId
        : undefined;

    socket?.emit('call:end', { dealRoomId, callLogId });
    cleanupCall();
    onCallEnd();
  }

  function toggleMute() {
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setMuted((m) => !m);
  }

  function toggleCamera() {
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !t.enabled;
    });
    setCameraOff((c) => !c);
  }

  async function toggleScreenShare() {
    if (callState.phase !== 'active') return;
    if (screenSharing) {
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenSharing(false);
      socket?.emit('screen:share-stop', { dealRoomId: callState.dealRoomId });
      if (localStreamRef.current) {
        const sender = pcRef.current
          ?.getSenders()
          .find((s) => s.track?.kind === 'video');
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (sender && videoTrack) await sender.replaceTrack(videoTrack);
      }
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screen;
        const screenTrack = screen.getVideoTracks()[0];
        if (screenTrack) {
          const sender = pcRef.current
            ?.getSenders()
            .find((s) => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(screenTrack);
          screenTrack.onended = () => toggleScreenShare();
        }
        setScreenSharing(true);
        socket?.emit('screen:share-start', { dealRoomId: callState.dealRoomId });
      } catch {
        // user cancelled screen share
      }
    }
  }

  useEffect(() => {
    if (!socket) return;

    const handleOffer = async (payload: { sdp: string; fromUserId: string }) => {
      if (callState.phase !== 'incoming' && callState.phase !== 'active') return;
      const peerUserId =
        callState.phase === 'incoming' ? callState.fromUserId : callState.peerUserId;
      const pc = pcRef.current ?? setupPeerConnection(peerUserId, callState.dealRoomId);
      await pc.setRemoteDescription(JSON.parse(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', { sdp: JSON.stringify(answer), toUserId: payload.fromUserId });
    };

    const handleAnswer = async (payload: { sdp: string }) => {
      if (!pcRef.current) return;
      await pcRef.current.setRemoteDescription(JSON.parse(payload.sdp));
    };

    const handleICE = async (payload: { candidate: string }) => {
      if (!pcRef.current) return;
      try {
        await pcRef.current.addIceCandidate(JSON.parse(payload.candidate));
      } catch {
        // ignore stale ICE
      }
    };

    const handleEnded = () => {
      cleanupCall();
      onCallEnd();
    };

    socket.on('call:offer', handleOffer);
    socket.on('call:answer', handleAnswer);
    socket.on('call:ice-candidate', handleICE);
    socket.on('call:ended', handleEnded);
    socket.on('call:rejected', handleEnded);

    return () => {
      socket.off('call:offer', handleOffer);
      socket.off('call:answer', handleAnswer);
      socket.off('call:ice-candidate', handleICE);
      socket.off('call:ended', handleEnded);
      socket.off('call:rejected', handleEnded);
    };
  }, [socket, callState, setupPeerConnection, cleanupCall, onCallEnd]);

  useEffect(() => {
    if (callState.phase === 'outgoing') {
      void initiateOutgoingCall();
    }
    if (callState.phase === 'incoming') {
      setRingtoneActive(true);
    }
    if (callState.phase === 'idle') {
      cleanupCall();
    }
  }, [callState.phase]);

  useEffect(() => {
    return () => {
      cleanupCall();
    };
  }, [cleanupCall]);

  if (!isVisible) return null;

  const peerName =
    callState.phase === 'incoming'
      ? callState.fromPseudonym
      : callState.phase === 'outgoing'
        ? callState.toPseudonym
        : callState.phase === 'active'
          ? callState.peerPseudonym
          : '';

  const isVideo =
    (callState.phase === 'incoming' || callState.phase === 'outgoing' || callState.phase === 'active') &&
    callState.callType === 'video';

  const formattedDuration = `${String(Math.floor(durationSec / 60)).padStart(2, '0')}:${String(durationSec % 60).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 backdrop-blur-2xl">
      {/* Encrypted indicator */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-xs text-emerald-200 uppercase tracking-[0.2em]">
        <Lock className="h-3.5 w-3.5" />
        Call encrypted
      </div>

      {/* Duration (active only) */}
      {callState.phase === 'active' && (
        <div className="absolute top-6 right-8 text-sm text-stone-400 font-mono">
          {formattedDuration}
        </div>
      )}

      {callState.phase === 'incoming' ? (
        /* ── Incoming Call Screen ── */
        <div className="flex flex-col items-center gap-8">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-amber-300/30 bg-amber-400/15 text-4xl text-amber-200">
              {peerName.charAt(0).toUpperCase()}
            </div>
            <h2 className="text-3xl font-light text-stone-50">{peerName}</h2>
            <p className="text-sm text-stone-400 uppercase tracking-[0.2em]">
              Incoming {callState.callType} call
            </p>
            {ringtoneActive && (
              <div className="flex gap-1 mt-2">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="w-1 bg-amber-300/60 rounded-full animate-pulse"
                    style={{
                      height: `${12 + i * 6}px`,
                      animationDelay: `${i * 0.1}s`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-6">
            <button
              type="button"
              onClick={rejectIncomingCall}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={() => void acceptIncomingCall()}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
            >
              {callState.callType === 'video' ? (
                <Video className="h-7 w-7" />
              ) : (
                <Mic className="h-7 w-7" />
              )}
            </button>
          </div>
        </div>
      ) : callState.phase === 'outgoing' ? (
        /* ── Outgoing (ringing) Screen ── */
        <div className="flex flex-col items-center gap-8">
          <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-stone-300/20 bg-stone-400/10 text-4xl text-stone-200">
            {peerName.charAt(0).toUpperCase()}
          </div>
          <div className="text-center">
            <h2 className="text-3xl font-light text-stone-50">{peerName}</h2>
            <p className="mt-2 text-sm text-stone-400 animate-pulse">Ringing…</p>
          </div>
          <button
            type="button"
            onClick={handleEndCall}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            <PhoneOff className="h-7 w-7" />
          </button>
        </div>
      ) : (
        /* ── Active Call Screen ── */
        <div className="relative w-full h-full">
          {/* Remote video / audio waveform */}
          {isVideo ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-6">
              <div className="flex h-28 w-28 items-center justify-center rounded-full border-2 border-stone-300/20 bg-stone-400/10 text-5xl text-stone-200">
                {peerName.charAt(0).toUpperCase()}
              </div>
              <p className="text-2xl text-stone-200">{peerName}</p>
              {/* Animated waveform */}
              <div className="flex items-end gap-1 h-10">
                {Array.from({ length: 12 }, (_, i) => (
                  <span
                    key={i}
                    className="w-1.5 rounded-full bg-amber-300/50 animate-pulse"
                    style={{
                      height: `${8 + Math.random() * 24}px`,
                      animationDelay: `${i * 0.08}s`,
                      animationDuration: `${0.6 + Math.random() * 0.6}s`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Local PiP */}
          {isVideo && (
            <div className="absolute bottom-24 right-6 h-36 w-24 rounded-2xl overflow-hidden border border-white/20 shadow-xl">
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover mirror"
              />
              {cameraOff && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <VideoOff className="h-6 w-6 text-stone-300" />
                </div>
              )}
            </div>
          )}

          {/* Peer name */}
          <div className="absolute top-20 left-1/2 -translate-x-1/2 text-center">
            <p className="text-lg text-stone-300">{peerName}</p>
          </div>

          {/* Controls bar */}
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center gap-4 bg-gradient-to-t from-black/80 to-transparent px-8 py-8">
            <button
              type="button"
              onClick={toggleMute}
              className={`flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
                muted
                  ? 'border-red-400/40 bg-red-500/20 text-red-300'
                  : 'border-white/20 bg-white/10 text-stone-200 hover:bg-white/20'
              }`}
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>

            {isVideo && (
              <button
                type="button"
                onClick={toggleCamera}
                className={`flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
                  cameraOff
                    ? 'border-red-400/40 bg-red-500/20 text-red-300'
                    : 'border-white/20 bg-white/10 text-stone-200 hover:bg-white/20'
                }`}
              >
                {cameraOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => void toggleScreenShare()}
              className={`flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
                screenSharing
                  ? 'border-amber-400/40 bg-amber-500/20 text-amber-300'
                  : 'border-white/20 bg-white/10 text-stone-200 hover:bg-white/20'
              }`}
            >
              {screenSharing ? <MonitorOff className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
            </button>

            <button
              type="button"
              onClick={handleEndCall}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              <PhoneOff className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
