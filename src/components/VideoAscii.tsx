import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { computeShapeVectors } from "../lib/ascii-utils";
import { DEFAULT_CHARS, parseProps } from "../lib/ascii-props";
import type {
    Props,
    RecordedAsciiVideo,
    RecordingOptions,
    VideoAsciiHandle,
} from "../lib/ascii-props";
import { createGLResources } from "../lib/create-gl-resources";
import { createScatterEffect } from "../lib/scatter-effect";
import { createMouseTrail } from "../lib/brighten-effect";
import { createClickEffect } from "../lib/click-effect";
import { createSpreadEffect } from "../lib/spread-effect";

const RECORDING_MIME_CANDIDATES = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
];

const DEFAULT_RECORDING_FILE_NAME = 'ascii-video';
const MIN_RECORDING_DIMENSION = 16;
const MAX_RECORDING_DIMENSION = 7680;
const MAX_RECORDING_SCALE = 4;

const recordingControlsStyle = {
    position: 'absolute',
    right: 12,
    bottom: 12,
    zIndex: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    background: 'rgba(8, 10, 16, 0.78)',
    border: '1px solid rgba(255, 255, 255, 0.18)',
    borderRadius: 8,
    color: 'white',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
    backdropFilter: 'blur(10px)',
} as const;

const recordingButtonStyle = {
    border: '1px solid rgba(255, 255, 255, 0.22)',
    borderRadius: 6,
    padding: '6px 10px',
    background: 'rgba(255, 255, 255, 0.12)',
    color: 'white',
    font: 'inherit',
    cursor: 'pointer',
} as const;

const disabledRecordingButtonStyle = {
    ...recordingButtonStyle,
    cursor: 'not-allowed',
    opacity: 0.45,
} as const;

const recordingErrorStyle = {
    maxWidth: 220,
    color: '#ffb4b4',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
} as const;

function resolveRecordingMimeType(preferred?: string): string | null {
    if (typeof MediaRecorder === 'undefined') return null;
    if (preferred && MediaRecorder.isTypeSupported(preferred)) return preferred;
    return RECORDING_MIME_CANDIDATES.find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

function getRecordingExtension(mimeType: string): 'webm' | 'mp4' {
    return mimeType.toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

function getDownloadFileName(fileName: string | undefined, extension: 'webm' | 'mp4') {
    const baseName = fileName?.trim() || DEFAULT_RECORDING_FILE_NAME;
    return /\.(webm|mp4)$/i.test(baseName) ? baseName : `${baseName}.${extension}`;
}

function downloadAsciiRecording(recording: RecordedAsciiVideo, fileName?: string) {
    const link = document.createElement('a');
    link.href = recording.url;
    link.download = getDownloadFileName(fileName, recording.extension);
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function clampRecordingDimension(value: number) {
    return Math.max(MIN_RECORDING_DIMENSION, Math.min(MAX_RECORDING_DIMENSION, Math.round(value)));
}

function resolveRecordingDimensions(canvas: HTMLCanvasElement, options: RecordingOptions, videoWidth?: number, videoHeight?: number) {
    // Use video dimensions if provided (to preserve original aspect ratio), otherwise use canvas
    const sourceWidth = Math.max(1, videoWidth ?? canvas.width);
    const sourceHeight = Math.max(1, videoHeight ?? canvas.height);
    const scale = Math.max(1, Math.min(MAX_RECORDING_SCALE, options.exportScale ?? 1));
    const hasWidth = typeof options.exportWidth === 'number' && options.exportWidth > 0;
    const hasHeight = typeof options.exportHeight === 'number' && options.exportHeight > 0;

    if (hasWidth && hasHeight) {
        return {
            width: clampRecordingDimension(options.exportWidth!),
            height: clampRecordingDimension(options.exportHeight!),
        };
    }
    if (hasWidth) {
        const width = clampRecordingDimension(options.exportWidth!);
        return {
            width,
            height: clampRecordingDimension(width * sourceHeight / sourceWidth),
        };
    }
    if (hasHeight) {
        const height = clampRecordingDimension(options.exportHeight!);
        return {
            width: clampRecordingDimension(height * sourceWidth / sourceHeight),
            height,
        };
    }

    return {
        width: clampRecordingDimension(sourceWidth * scale),
        height: clampRecordingDimension(sourceHeight * scale),
    };
}

function estimateRecordingBitrate(width: number, height: number, frameRate: number) {
    const pixelRate = width * height * frameRate;
    return Math.round(Math.max(8_000_000, Math.min(40_000_000, pixelRate * 0.16)));
}

function captureVideoAudioStream(video: HTMLVideoElement | null): MediaStream | null {
    if (!video) return null;
    const source = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
        mozCaptureStream?: () => MediaStream;
    };
    const captureStream = source.captureStream ?? source.mozCaptureStream;
    return captureStream ? captureStream.call(source) : null;
}

const VideoAscii = forwardRef<VideoAsciiHandle, Props>(function VideoAscii({
        src,
        videoMode = false,
        numColsRaw = 250,
        brightnessRaw = 1.0,
        saturationRaw = 1.0,
        bgOpacityRaw = 0.3,
        revealEffect = false,
        chars = DEFAULT_CHARS,
        mouseEffect = true,
        clickEffect = true,
        charMode = 'shape',
        className,
        recording = false,
        recordingOptions,
        downloadOnRecordingStop = false,
        recordingControls = false,
        onRecordingStart,
        onRecordingStop,
        onRecordingError,
    }: Props, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const atlasTextureRef = useRef<WebGLTexture | null>(null);
    const scatterAtlasTextureRef = useRef<WebGLTexture | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const recordingChunksRef = useRef<Blob[]>([]);
    const recordingMimeTypeRef = useRef('video/webm');
    const recordingStartTimeRef = useRef(0);
    const recordingStreamRef = useRef<MediaStream | null>(null);
    const recordingCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const recordingFrameCopyRef = useRef<(() => void) | null>(null);
    const recordingStopResolverRef = useRef<((recording: RecordedAsciiVideo | null) => void) | null>(null);
    const recordingStopPromiseRef = useRef<Promise<RecordedAsciiVideo | null> | null>(null);
    const recordingOptionsRef = useRef<RecordingOptions | undefined>(recordingOptions);
    const downloadOnRecordingStopRef = useRef(downloadOnRecordingStop);
    const onRecordingStartRef = useRef(onRecordingStart);
    const onRecordingStopRef = useRef(onRecordingStop);
    const onRecordingErrorRef = useRef(onRecordingError);
    const lastRecordingRef = useRef<RecordedAsciiVideo | null>(null);
    const recordingPropWasEnabledRef = useRef(false);
    const [isRecording, setIsRecording] = useState(false);
    const [lastRecording, setLastRecording] = useState<RecordedAsciiVideo | null>(null);
    const [recordingError, setRecordingError] = useState<string | null>(null);

    const { numCols, brightness, saturation, bgOpacity,
            mouseEnabled, mouseStyle, brightenEnabled, scatterEnabled,
            scatterChars, trailLen, trailDecay, duration, mouseRadius, mouseBrightness,
            clickEnabled, clickBrightness, clickSpeed,
            spreadEnabled, spreadExpandDuration, spreadSpeed,
            revealEnabled, revealDuration, revealEffectFlag,
    } = parseProps(numColsRaw, brightnessRaw, saturationRaw, bgOpacityRaw, mouseEffect, clickEffect, revealEffect);

    // refs for props that update dynamically without full GL reinit
    const brightnessRef = useRef(brightness);
    const saturationRef = useRef(saturation);
    const bgOpacityRef = useRef(bgOpacity);
    const mouseEnabledRef = useRef(mouseEnabled);
    const mouseStyleRef = useRef(mouseStyle);
    const brightenEnabledRef = useRef(brightenEnabled);
    const scatterEnabledRef = useRef(scatterEnabled);
    const mouseBrightnessRef = useRef(mouseBrightness);
    const mouseRadiusRef = useRef(mouseRadius);
    const trailLenRef = useRef(trailLen);
    const trailDecayRef = useRef(trailDecay);
    const durationRef = useRef(duration);
    const scatterCharsRef = useRef(scatterChars);
    const clickEnabledRef = useRef(clickEnabled);
    const clickBrightnessRef = useRef(clickBrightness);
    const clickSpeedRef = useRef(clickSpeed);
    const spreadEnabledRef = useRef(spreadEnabled);
    const spreadExpandDurationRef = useRef(spreadExpandDuration);
    const spreadSpeedRef = useRef(spreadSpeed);
    const numColsRef = useRef(numCols);
    const videoModeRef = useRef(videoMode);
    // update refs inside useEffect (not in render) -> avoids unintentional errors
    useEffect(() => {
        brightnessRef.current = brightness;
        saturationRef.current = saturation;
        bgOpacityRef.current = bgOpacity;
        mouseEnabledRef.current = mouseEnabled;
        mouseStyleRef.current = mouseStyle;
        brightenEnabledRef.current = brightenEnabled;
        scatterEnabledRef.current = scatterEnabled;
        mouseBrightnessRef.current = mouseBrightness;
        mouseRadiusRef.current = mouseRadius;
        trailLenRef.current = trailLen;
        trailDecayRef.current = trailDecay;
        durationRef.current = duration;
        // rebuild immediately after ref -> no effect ordering ambiguity
        if (scatterCharsRef.current !== scatterChars && loadedRef.current) {
            scatterCharsRef.current = scatterChars;
            rebuildScatterAtlasRef.current?.();
        } else {
            scatterCharsRef.current = scatterChars;
        }
        clickEnabledRef.current = clickEnabled;
        clickBrightnessRef.current = clickBrightness;
        clickSpeedRef.current = clickSpeed;
        spreadEnabledRef.current = spreadEnabled;
        spreadExpandDurationRef.current = spreadExpandDuration;
        spreadSpeedRef.current = spreadSpeed;
        numColsRef.current = numCols;
        videoModeRef.current = videoMode;
    }, [
        brightness,
        saturation,
        bgOpacity,
        mouseEnabled,
        mouseStyle,
        brightenEnabled,
        scatterEnabled,
        mouseBrightness,
        mouseRadius,
        trailLen,
        trailDecay,
        duration,
        scatterChars,
        clickEnabled,
        clickBrightness,
        clickSpeed,
        spreadEnabled,
        spreadExpandDuration,
        spreadSpeed,
        numCols,
        videoMode,
    ]);

    const setupGridRef = useRef<((nc: number) => void) | null>(null);
    const rebuildScatterAtlasRef = useRef<(() => void) | null>(null);
    const loadedRef = useRef(false);
    const canvasTargetSizeRef = useRef({ width: 0, height: 0 });

    useEffect(() => {
        recordingOptionsRef.current = recordingOptions;
        downloadOnRecordingStopRef.current = downloadOnRecordingStop;
        onRecordingStartRef.current = onRecordingStart;
        onRecordingStopRef.current = onRecordingStop;
        onRecordingErrorRef.current = onRecordingError;
    }, [recordingOptions, downloadOnRecordingStop, onRecordingStart, onRecordingStop, onRecordingError]);

    const reportRecordingError = useCallback((error: Error) => {
        setRecordingError(error.message);
        onRecordingErrorRef.current?.(error);
    }, []);

    const startRecording = useCallback((options?: RecordingOptions) => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') return true;

        const canvas = canvasRef.current;
        if (!canvas || typeof canvas.captureStream !== 'function') {
            reportRecordingError(new Error('Canvas recording is not supported in this browser.'));
            return false;
        }
        if (canvas.width <= 0 || canvas.height <= 0) {
            reportRecordingError(new Error('The ASCII canvas is not ready yet.'));
            return false;
        }

        const mergedOptions = { ...recordingOptionsRef.current, ...options };
        const mimeType = resolveRecordingMimeType(mergedOptions.mimeType);
        if (!mimeType) {
            reportRecordingError(new Error('This browser does not support WebM or MP4 recording through MediaRecorder.'));
            return false;
        }

        const frameRate = Math.max(1, Math.round(mergedOptions.frameRate ?? 30));
        const videoWidth = videoRef.current?.videoWidth || undefined;
        const videoHeight = videoRef.current?.videoHeight || undefined;
        const recordingSize = resolveRecordingDimensions(canvas, mergedOptions, videoWidth, videoHeight);
        let stream: MediaStream;

        if (recordingSize.width === canvas.width && recordingSize.height === canvas.height) {
            stream = canvas.captureStream(frameRate);
            recordingFrameCopyRef.current = null;
            recordingCanvasRef.current = null;
        } else {
            const recordingCanvas = document.createElement('canvas');
            recordingCanvas.width = recordingSize.width;
            recordingCanvas.height = recordingSize.height;
            const recordingCtx = recordingCanvas.getContext('2d', { alpha: false });
            if (!recordingCtx || typeof recordingCanvas.captureStream !== 'function') {
                reportRecordingError(new Error('High quality canvas recording is not supported in this browser.'));
                return false;
            }
            recordingCtx.imageSmoothingEnabled = false;
            const copyFrame = () => {
                recordingCtx.drawImage(canvas, 0, 0, recordingSize.width, recordingSize.height);
            };
            copyFrame();
            recordingCanvasRef.current = recordingCanvas;
            recordingFrameCopyRef.current = copyFrame;
            stream = recordingCanvas.captureStream(frameRate);
        }

        if (mergedOptions.includeAudio) {
            captureVideoAudioStream(videoRef.current)?.getAudioTracks().forEach(track => {
                stream.addTrack(track);
            });
        }

        const mediaRecorderOptions: MediaRecorderOptions = { mimeType };
        const videoBitsPerSecond = mergedOptions.videoBitsPerSecond
            ?? (mergedOptions.bitsPerSecond ? undefined : estimateRecordingBitrate(recordingSize.width, recordingSize.height, frameRate));
        if (videoBitsPerSecond) mediaRecorderOptions.videoBitsPerSecond = videoBitsPerSecond;
        if (mergedOptions.audioBitsPerSecond) mediaRecorderOptions.audioBitsPerSecond = mergedOptions.audioBitsPerSecond;
        if (mergedOptions.bitsPerSecond) mediaRecorderOptions.bitsPerSecond = mergedOptions.bitsPerSecond;

        try {
            const recorder = new MediaRecorder(stream, mediaRecorderOptions);
            recordingChunksRef.current = [];
            recordingMimeTypeRef.current = mimeType;
            recordingStartTimeRef.current = performance.now();
            recordingStreamRef.current = stream;
            recorderRef.current = recorder;

            recorder.ondataavailable = event => {
                if (event.data.size > 0) recordingChunksRef.current.push(event.data);
            };
            recorder.onerror = event => {
                const maybeError = event as Event & { error?: unknown };
                const error = maybeError.error instanceof Error
                    ? maybeError.error
                    : new Error('The ASCII video recorder failed.');
                reportRecordingError(error);
            };
            recorder.onstop = () => {
                stream.getTracks().forEach(track => track.stop());
                recordingFrameCopyRef.current = null;
                recordingCanvasRef.current = null;
                recordingStreamRef.current = null;
                recorderRef.current = null;
                setIsRecording(false);

                const blob = new Blob(recordingChunksRef.current, { type: recordingMimeTypeRef.current });
                const recordingResult = blob.size > 0
                    ? {
                        blob,
                        url: URL.createObjectURL(blob),
                        mimeType: recordingMimeTypeRef.current,
                        extension: getRecordingExtension(recordingMimeTypeRef.current),
                        durationMs: Math.max(0, performance.now() - recordingStartTimeRef.current),
                    }
                    : null;

                if (recordingResult) {
                    lastRecordingRef.current = recordingResult;
                    setLastRecording(recordingResult);
                    onRecordingStopRef.current?.(recordingResult);
                    if (downloadOnRecordingStopRef.current) {
                        downloadAsciiRecording(recordingResult, recordingOptionsRef.current?.fileName);
                    }
                }

                recordingStopResolverRef.current?.(recordingResult);
                recordingStopResolverRef.current = null;
                recordingStopPromiseRef.current = null;
            };

            recorder.start(mergedOptions.timeSliceMs);
            setRecordingError(null);
            setIsRecording(true);
            onRecordingStartRef.current?.(mimeType);
            return true;
        } catch (error) {
            stream.getTracks().forEach(track => track.stop());
            recorderRef.current = null;
            recordingStreamRef.current = null;
            recordingFrameCopyRef.current = null;
            recordingCanvasRef.current = null;
            reportRecordingError(error instanceof Error ? error : new Error('The ASCII video recorder could not start.'));
            return false;
        }
    }, [reportRecordingError]);

    const stopRecording = useCallback(() => {
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === 'inactive') return Promise.resolve(null);
        if (recordingStopPromiseRef.current) return recordingStopPromiseRef.current;

        recordingStopPromiseRef.current = new Promise(resolve => {
            recordingStopResolverRef.current = resolve;
        });
        recorder.stop();
        return recordingStopPromiseRef.current;
    }, []);

    const downloadRecording = useCallback((recordingToDownload?: RecordedAsciiVideo, fileName?: string) => {
        const targetRecording = recordingToDownload ?? lastRecordingRef.current;
        if (!targetRecording) return;
        downloadAsciiRecording(targetRecording, fileName ?? recordingOptionsRef.current?.fileName);
    }, []);

    useImperativeHandle(ref, () => ({
        startRecording,
        stopRecording,
        downloadRecording,
        isRecording: () => !!recorderRef.current && recorderRef.current.state !== 'inactive',
        getLastRecording: () => lastRecordingRef.current,
    }), [downloadRecording, startRecording, stopRecording]);

    useEffect(() => {
        if (recording && !recordingPropWasEnabledRef.current) {
            startRecording();
        } else if (!recording && recordingPropWasEnabledRef.current) {
            void stopRecording();
        }
        recordingPropWasEnabledRef.current = recording;
    }, [recording, startRecording, stopRecording]);

    useEffect(() => () => {
        const recorder = recorderRef.current;
        recorderRef.current = null;
        recordingFrameCopyRef.current = null;
        recordingCanvasRef.current = null;
        recordingStreamRef.current?.getTracks().forEach(track => track.stop());
        recordingStreamRef.current = null;
        if (recorder && recorder.state !== 'inactive') {
            recorder.ondataavailable = null;
            recorder.onerror = null;
            recorder.onstop = null;
            recorder.stop();
        }
    }, []);

    // numCols change -> refresh atlas/grid textures without full GL reinit
    useEffect(() => {
        if (loadedRef.current) {
            setupGridRef.current?.(numCols);
        }
    }, [numCols]);

    useEffect(() => {
        loadedRef.current = false;

        let shapeData: { char: string, vector: number[] }[] = [];
        let gridCols = 0;
        let gridRows = 0;
        let charW = 1;
        let charH = 1;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const video = videoRef.current;
        if (!video) return;

        const gl = canvas.getContext("webgl2");
        if (!gl) return;

        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

        // all gl textures, uniform locations, etc. in resources
        const resources = createGLResources(gl);
        if (!resources) return;

        const { program, pass1Program } = resources;
        atlasTextureRef.current = resources.atlasTexture;
        scatterAtlasTextureRef.current = resources.scatterAtlasTexture;

        gl.uniform1i(resources.shapeMatchingLoc, charMode === 'shape' ? 1 : 0);
        gl.uniform1i(resources.revealEffectFlagLoc, revealEffectFlag);
        gl.uniform1f(resources.revealProgressLoc, 0.0);

        // create effect handlers
        const scatterEffects = createScatterEffect({ scatterEnabledRef, mouseRadiusRef, durationRef, scatterCharsRef });
        const trailEffects = createMouseTrail({ brightenEnabledRef, trailLenRef, durationRef, trailDecayRef });
        const clickEffects = createClickEffect({ clickEnabledRef, clickSpeedRef, clickBrightnessRef });
        const spreadEffects = createSpreadEffect({ spreadEnabledRef, scatterCharsRef, spreadExpandDurationRef, spreadSpeedRef });

        let animFrameId: number;
        let lastTime = -1;
        let startTime = -1;
        let currentVidIndex = 0;

        const sources = Array.isArray(src) ? src : [src];
        const isMultiSource = sources.length > 1;

        // extract hiddenCtx (use it for all reusable writing)
        const hiddenCanvas = document.createElement('canvas');
        const hiddenCtx = hiddenCanvas.getContext('2d')!;

        // sets up new character grid based on column count
        const setupGrid = (nc: number) => {
            if (canvasTargetSizeRef.current.width > 0 && canvasTargetSizeRef.current.height > 0) {
                canvas.width = canvasTargetSizeRef.current.width;
                canvas.height = canvasTargetSizeRef.current.height;
            }

            charW = Math.max(1, Math.floor(canvas.width / nc)); // num pixels per char (width)
            // probe and scale to find charH
            const probe = charW * 2;
            hiddenCtx.font = `${probe}px monospace`;
            // try a font size of double width, find actually how wide it is, use this as scale factor
            const measuredWidth = hiddenCtx.measureText('M').width || charW;
            charH = Math.max(1, Math.round(probe * charW / measuredWidth));

            gridCols = Math.max(1, Math.floor(canvas.width / charW));
            gridRows = Math.max(1, Math.floor(canvas.height / charH));

            // snap canvas to exact integer multiples (no float boundary errors) -> fill with css not with gpu
                // only small stretch: shader crops video to canvas, canvas gets stretched to container
            canvas.width = gridCols * charW;
            canvas.height = gridRows * charH;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.useProgram(program);
            gl.uniform2f(resources.resLoc, canvas.width, canvas.height);
            gl.useProgram(pass1Program);
            gl.uniform2f(resources.p1ResLoc, canvas.width, canvas.height);
            gl.useProgram(program);

            // resize for scatter and spread effects
            scatterEffects.setup(gl, gridCols, gridRows, charW, charH, resources.scatterStateTexture);
            spreadEffects.setup(gl, gridCols, gridRows, charW, charH, resources.spreadStateTexture);

            if (charMode === 'shape') {
                shapeData = computeShapeVectors(chars, charW, charH);

                // need 2 rows -> can only store 4 floats per char
                // row 0: components [v0,v1,v2,v3], row 1: components [v4,v5,_,_]
                const numChars = shapeData.length;
                const charVectorData = new Float32Array(numChars * 8);
                for (let i = 0; i < numChars; i++) {
                    const v = shapeData[i].vector;
                    charVectorData[i * 4 + 0] = v[0];
                    charVectorData[i * 4 + 1] = v[1];
                    charVectorData[i * 4 + 2] = v[2];
                    charVectorData[i * 4 + 3] = v[3];
                    // row 2
                    charVectorData[numChars * 4 + i * 4 + 0] = v[4];
                    charVectorData[numChars * 4 + i * 4 + 1] = v[5];
                }
                gl.activeTexture(gl.TEXTURE2);
                gl.bindTexture(gl.TEXTURE_2D, resources.charVectorsTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, numChars, 2, 0, gl.RGBA, gl.FLOAT, charVectorData);

                // size FBO texture to match grid dimensions (or resize)
                gl.activeTexture(gl.TEXTURE3);
                gl.bindTexture(gl.TEXTURE_2D, resources.fboTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, gridCols, gridRows, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, null);
                gl.bindFramebuffer(gl.FRAMEBUFFER, resources.fbo);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resources.fboTexture, 0);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);

                // scale sampling density with font size
                const circleN = Math.max(1, Math.round(charW / 5));
                gl.useProgram(pass1Program);
                gl.uniform2f(resources.p1CellsizeLoc, charW, charH);
                gl.uniform1i(resources.p1CircleNLoc, circleN);
                gl.uniform1i(resources.p1NumCharsLoc, numChars);
                gl.uniform1f(resources.p1ExponentLoc, 2.0);
                gl.useProgram(program);
            }

            gl.uniform2f(resources.gridSizeLoc, gridCols, gridRows);

            hiddenCanvas.width = chars.length * charW;
            hiddenCanvas.height = charH;
            hiddenCtx.font = `${charH}px monospace`;
            hiddenCtx.fillStyle = 'black';
            hiddenCtx.fillRect(0, 0, chars.length * charW, charH);
            hiddenCtx.fillStyle = 'white';
            hiddenCtx.textBaseline = 'top';
            for (let c = 0; c < chars.length; c++) {
                hiddenCtx.fillText(chars[c], c * charW, 0);
            }
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, atlasTextureRef.current);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, hiddenCanvas);
            gl.uniform1f(resources.numLoc, chars.length);
            gl.uniform2f(resources.sizeLoc, charW, charH);

            rebuildScatterAtlas();
        };

        // explicit rebuild of scatter atlas texture
        const rebuildScatterAtlas = () => {
            const sc = scatterCharsRef.current;
            hiddenCanvas.width = sc.length * charW;
            hiddenCanvas.height = charH;
            hiddenCtx.fillStyle = 'black';
            hiddenCtx.fillRect(0, 0, hiddenCanvas.width, charH);
            hiddenCtx.fillStyle = 'white';
            hiddenCtx.textBaseline = 'top';
            hiddenCtx.font = `${charH}px monospace`;
            for (let c = 0; c < sc.length; c++) {
                hiddenCtx.fillText(sc[c], c * charW, 0);
            }
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, scatterAtlasTextureRef.current);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, hiddenCanvas);
            gl.uniform1f(resources.scatterNumCharsLoc, sc.length);
            scatterEffects.reset(gl);
        };

        // attach functions to refs -> can call outside of useEffect without rerender
        setupGridRef.current = setupGrid;
        rebuildScatterAtlasRef.current = rebuildScatterAtlas;

        // size canvas to container display dimensions
        const setupCanvas = (containerW: number, containerH: number) => {
            canvasTargetSizeRef.current = {
                width: Math.max(1, Math.round(containerW)),
                height: Math.max(1, Math.round(containerH)),
            };
            setupGrid(numColsRef.current);

            // center-crop video to match snapped canvas AR (avoids slight AR error from container dimensions)
            const videoAR = video.videoWidth / video.videoHeight;
            const displayAR = canvas.width / canvas.height;
            let scaleX = 1.0;
            let scaleY = 1.0;
            let offsetX = 0.0;
            let offsetY = 0.0;
            if (displayAR > videoAR) { // video is taller relative -> need to scale video up so that top and bot overflow
                scaleY = videoAR / displayAR;
                offsetY = (1.0 - scaleY) / 2.0;
            } else { // video shorter -> scale video up so that left and right overflow
                scaleX = displayAR / videoAR;
                offsetX = (1.0 - scaleX) / 2.0;
            }
            gl.uniform2f(resources.cropOffsetLoc, offsetX, offsetY);
            gl.uniform2f(resources.cropScaleLoc, scaleX, scaleY);
            gl.useProgram(pass1Program);
            gl.uniform2f(resources.p1CropOffsetLoc, offsetX, offsetY);
            gl.uniform2f(resources.p1CropScaleLoc, scaleX, scaleY);
            gl.useProgram(program);
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!mouseEnabledRef.current) return;
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            const t = performance.now();
            trailEffects.handleMouseMove(x, y, t);
            scatterEffects.handleMouseMove(x, y, t);
        };
        canvas.addEventListener("mousemove", onMouseMove);

        const onMouseLeave = () => scatterEffects.handleMouseLeave();
        canvas.addEventListener("mouseleave", onMouseLeave);

        const onClick = (e: MouseEvent) => {
            clickEffects.handleClick(e, canvas);
            spreadEffects.handleClick(e, canvas);
        };
        canvas.addEventListener("click", onClick);

        const loop = () => {
            // update dynamic uniforms per frame
            gl.uniform1i(resources.videoModeLoc, videoModeRef.current ? 1 : 0);
            gl.uniform1f(resources.brightnessLoc, brightnessRef.current);
            gl.uniform1f(resources.saturationLoc, saturationRef.current);
            gl.uniform1f(resources.bgOpacityLoc, bgOpacityRef.current);
            gl.uniform1i(resources.mouseEffectFlagLoc, brightenEnabledRef.current ? 1 : 0);
            gl.uniform1i(resources.scatterEffectFlagLoc, scatterEnabledRef.current ? 1 : 0);
            gl.uniform1i(resources.clickEffectFlagLoc, clickEnabledRef.current ? 1 : 0);
            gl.uniform1i(resources.spreadEffectFlagLoc, spreadEnabledRef.current ? 1 : 0);
            gl.uniform1f(resources.mouseBrightnessLoc, mouseBrightnessRef.current);
            gl.uniform1f(resources.mouseRadiusLoc, Math.min(canvas.width, canvas.height) * mouseRadiusRef.current);

            if (revealEnabled) {
                const progress = startTime < 0 ? 0.0 : Math.min(1.0, (performance.now() - startTime) / (revealDuration * 1000));
                gl.uniform1f(resources.revealProgressLoc, progress);
            }

            if (loadedRef.current && video.currentTime != lastTime && video.readyState >= 2) {
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, resources.texture);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video);
                lastTime = video.currentTime;
            }

            trailEffects.tick(gl, resources.mousePositionsLoc, resources.mouseLifeFracsLoc);
            scatterEffects.tick(gl, canvas);
            clickEffects.tick(gl, canvas, resources.ripplePositionsLoc, resources.rippleRadiiLoc, resources.rippleBrightnessesLoc);
            spreadEffects.tick(gl);

            if (charMode === 'shape') {
                // 2 pass -> switch between the two fragment shaders each frame
                gl.bindFramebuffer(gl.FRAMEBUFFER, resources.fbo);
                gl.viewport(0, 0, gridCols, gridRows);
                gl.useProgram(pass1Program);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                gl.bindFramebuffer(gl.FRAMEBUFFER, null);
                gl.viewport(0, 0, canvas.width, canvas.height);
                gl.useProgram(program);
            }
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            recordingFrameCopyRef.current?.();
            animFrameId = requestAnimationFrame(loop);
        };

        const onLoaded = () => {
            const containerEl = containerRef.current!;
            setupCanvas(containerEl.clientWidth || video.videoWidth, containerEl.clientHeight || video.videoHeight);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, resources.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

            video.play();
            startTime = performance.now();
            loadedRef.current = true;
            animFrameId = requestAnimationFrame(loop);
        };

        const onEnded = () => {
            currentVidIndex = (currentVidIndex + 1) % sources.length;
            video.src = sources[currentVidIndex];
            video.load();
            video.addEventListener('canplay', () => video.play(), { once: true });
        };

        // resize canvas when container is resized
        const ro = new ResizeObserver(entries => {
            const { width, height } = entries[0].contentRect;
            if (loadedRef.current && width > 0 && height > 0) {
                setupCanvas(width, height);
            }
        });
        if (containerRef.current) {
            ro.observe(containerRef.current);
        }

        video.addEventListener("loadeddata", onLoaded, { once: true });
        if (isMultiSource) {
            video.addEventListener("ended", onEnded);
        }
        if (video.readyState >= 2 && video.currentSrc.endsWith(sources[0])) {
            onLoaded();
        } else if (!video.currentSrc.endsWith(sources[0])) {
            video.load(); // updates src in source -> need to trigger reload
        }

        return () => {
            ro.disconnect();
            setupGridRef.current = null;
            rebuildScatterAtlasRef.current = null;
            loadedRef.current = false;
            cancelAnimationFrame(animFrameId);
            video.removeEventListener("loadeddata", onLoaded);
            if (isMultiSource) {
                video.removeEventListener("ended", onEnded);
            }
            canvas.removeEventListener("mousemove", onMouseMove);
            canvas.removeEventListener("mouseleave", onMouseLeave);
            canvas.removeEventListener("click", onClick);

            gl.deleteTexture(resources.texture);
            gl.deleteTexture(resources.charVectorsTexture);
            gl.deleteFramebuffer(resources.fbo);
            gl.deleteTexture(resources.fboTexture);
            gl.deleteBuffer(resources.buffer);
            gl.deleteShader(resources.vertShader);
            gl.deleteShader(resources.fragShader);
            gl.deleteShader(resources.pass1FragShader);
            gl.deleteProgram(program);
            gl.deleteProgram(pass1Program);
            gl.deleteTexture(atlasTextureRef.current);
            gl.deleteTexture(scatterAtlasTextureRef.current);
            gl.deleteTexture(resources.scatterStateTexture);
            gl.deleteTexture(resources.spreadStateTexture);
        };
    }, [src, charMode, chars, revealEffectFlag, revealDuration, revealEnabled]);

    return (
        <div ref={containerRef} className={className} style={{ height: '100%', width: '100%', position: 'relative' }}>
            <video ref={videoRef} muted playsInline autoPlay crossOrigin="anonymous" loop={!Array.isArray(src) || src.length === 1} style={{ display: "none" }}>
                <source src={Array.isArray(src) ? src[0] : src} />
            </video>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
            {recordingControls && (
                <div
                    className={typeof recordingControls === 'object' ? recordingControls.className : undefined}
                    style={recordingControlsStyle}
                >
                    <button
                        type="button"
                        onClick={() => isRecording ? void stopRecording() : startRecording()}
                        style={recordingButtonStyle}
                    >
                        {isRecording ? 'Stop' : 'Record'}
                    </button>
                    <button
                        type="button"
                        disabled={!lastRecording || isRecording}
                        onClick={() => downloadRecording(lastRecording ?? undefined, typeof recordingControls === 'object' ? recordingControls.fileName : undefined)}
                        style={!lastRecording || isRecording ? disabledRecordingButtonStyle : recordingButtonStyle}
                    >
                        Export {lastRecording ? lastRecording.extension.toUpperCase() : 'Video'}
                    </button>
                    {recordingError && <span style={recordingErrorStyle}>{recordingError}</span>}
                </div>
            )}
        </div>
    );
});

export default VideoAscii;
