import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { VideoAscii } from '../src';
import type {
    ClickEffectOptions,
    MouseEffectOptions,
    RevealEffectOptions,
    VideoAsciiHandle,
} from '../src';
import './styles.css';

const DEFAULT_CHARS = " `.',-_:!;|\"~+^lr[](\\/L)>t<v=Tz?icf1{sIxY*jJno}CZyVwmSXRqM$O%#9&NW0Q@";
const DEMO_SOURCES = [
    'https://video-ascii-demo.vercel.app/bird.mp4',
    'https://video-ascii-demo.vercel.app/racing.mp4',
    'https://video-ascii-demo.vercel.app/nightlife.mp4',
];

type CharMode = 'shape' | 'luminance';
type MouseStyle = 'brighten' | 'scatter';
type ClickStyle = 'ripple' | 'spread';
type RevealType = 'random' | 'diagonal' | 'radial';
type MimeType = 'video/webm' | 'video/mp4';

interface DemoSettings {
    src: string;
    videoMode: boolean;
    numColsRaw: number;
    brightnessRaw: number;
    saturationRaw: number;
    bgOpacityRaw: number;
    chars: string;
    charMode: CharMode;
    mouseEnabled: boolean;
    mouseStyle: MouseStyle;
    mouseRadius: number;
    mouseDuration: number;
    mouseTrailLen: number;
    mouseTrailDecay: number;
    mouseBrightness: number;
    mouseScatterChars: string;
    clickEnabled: boolean;
    clickStyle: ClickStyle;
    clickBrightness: number;
    clickSpeed: number;
    clickExpandDuration: number;
    clickSpreadSpeed: number;
    revealEnabled: boolean;
    revealType: RevealType;
    revealDuration: number;
    exportMimeType: MimeType;
    exportScale: number;
    exportBitrateMbps: number;
}

const initialSettings: DemoSettings = {
    src: DEMO_SOURCES[0],
    videoMode: false,
    numColsRaw: initialColumns(),
    brightnessRaw: 1.25,
    saturationRaw: 1.25,
    bgOpacityRaw: 0.3,
    chars: DEFAULT_CHARS,
    charMode: 'shape',
    mouseEnabled: true,
    mouseStyle: 'brighten',
    mouseRadius: 0.09,
    mouseDuration: 1.2,
    mouseTrailLen: 15,
    mouseTrailDecay: 9,
    mouseBrightness: 2.5,
    mouseScatterChars: '->o',
    clickEnabled: true,
    clickStyle: 'ripple',
    clickBrightness: 1.1,
    clickSpeed: 2,
    clickExpandDuration: 1.5,
    clickSpreadSpeed: 7.5,
    revealEnabled: false,
    revealType: 'random',
    revealDuration: 0.4,
    exportMimeType: 'video/webm',
    exportScale: 2,
    exportBitrateMbps: 24,
};

function initialColumns() {
    const width = window.innerWidth;
    if (width < 480) return 50;
    if (width < 768) return 100;
    if (width < 1024) return 140;
    return 220;
}

function getMouseEffect(settings: DemoSettings): boolean | MouseEffectOptions {
    if (!settings.mouseEnabled) return false;
    if (settings.mouseStyle === 'scatter') {
        return {
            style: 'scatter',
            radius: settings.mouseRadius,
            duration: settings.mouseDuration,
            scatterChars: settings.mouseScatterChars,
        };
    }
    return {
        style: 'brighten',
        radius: settings.mouseRadius,
        duration: settings.mouseDuration,
        trailLen: settings.mouseTrailLen,
        trailDecay: settings.mouseTrailDecay,
        brightness: settings.mouseBrightness,
    };
}

function getClickEffect(settings: DemoSettings): boolean | ClickEffectOptions {
    if (!settings.clickEnabled) return false;
    if (settings.clickStyle === 'spread') {
        return {
            style: 'spread',
            spreadExpandDuration: settings.clickExpandDuration,
            spreadSpeed: settings.clickSpreadSpeed,
        };
    }
    return {
        style: 'ripple',
        brightness: settings.clickBrightness,
        speed: settings.clickSpeed,
    };
}

function getRevealEffect(settings: DemoSettings): boolean | RevealEffectOptions {
    if (!settings.revealEnabled) return false;
    return {
        type: settings.revealType,
        duration: settings.revealDuration,
    };
}

function SlidersIcon() {
    return (
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <line x1="1.5" y1="3.5" x2="13.5" y2="3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="4.5" cy="3.5" r="1.5" fill="currentColor" />
            <line x1="1.5" y1="7.5" x2="13.5" y2="7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="9.5" cy="7.5" r="1.5" fill="currentColor" />
            <line x1="1.5" y1="11.5" x2="13.5" y2="11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <circle cx="5.5" cy="11.5" r="1.5" fill="currentColor" />
        </svg>
    );
}

function CloseIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
    );
}

function UploadIcon() {
    return (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 7.5V2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            <path d="M3.5 4.5L6 2l2.5 2.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2 10h8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

function SourcePicker({
    active,
    uploadActive,
    hasUpload,
    uploadedName,
    onSelect,
    onFileSelect,
    onActivateUpload,
}: {
    active: number;
    uploadActive: boolean;
    hasUpload: boolean;
    uploadedName: string | null;
    onSelect: (index: number) => void;
    onFileSelect: (file: File) => void;
    onActivateUpload: () => void;
}) {
    const inputRef = useRef<HTMLInputElement | null>(null);

    const handleUploadClick = () => {
        if (!uploadActive && hasUpload) {
            onActivateUpload();
            return;
        }
        inputRef.current?.click();
    };

    return (
        <div className="src-picker">
            {DEMO_SOURCES.map((_, index) => (
                <button
                    key={index}
                    type="button"
                    className={`src-btn${!uploadActive && active === index ? ' active' : ''}`}
                    onClick={() => onSelect(index)}
                >
                    {index + 1}
                </button>
            ))}
            <button
                type="button"
                className={`src-upload-btn${uploadActive ? ' active' : hasUpload ? ' has-upload' : ''}`}
                title={uploadedName ?? 'Upload video'}
                onClick={handleUploadClick}
            >
                <UploadIcon />
            </button>
            <input
                ref={inputRef}
                type="file"
                accept="video/*"
                hidden
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const file = event.target.files?.[0];
                    if (file) onFileSelect(file);
                    event.target.value = '';
                }}
            />
        </div>
    );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
    return <button type="button" className={`toggle${value ? ' on' : ''}`} onClick={() => onChange(!value)} />;
}

function Slider({
    min,
    max,
    step,
    value,
    onChange,
    format,
}: {
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
    format?: (value: number) => string;
}) {
    return (
        <div className="slider-wrap">
            <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
            <span className="slider-val">{format ? format(value) : value}</span>
        </div>
    );
}

function Segment<T extends string>({
    options,
    value,
    onChange,
}: {
    options: T[];
    value: T;
    onChange: (value: T) => void;
}) {
    return (
        <div className="seg">
            {options.map(option => (
                <button key={option} type="button" className={value === option ? 'active' : ''} onClick={() => onChange(option)}>
                    {option}
                </button>
            ))}
        </div>
    );
}

function ControlRow({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="ctrl-row">
            <span className="ctrl-label">{label}</span>
            {children}
        </div>
    );
}

function ControlStack({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="ctrl-stack">
            <span className="ctrl-label">{label}</span>
            {children}
        </div>
    );
}

function Section({
    title,
    children,
    defaultOpen = true,
    className,
}: {
    title: string;
    children: ReactNode;
    defaultOpen?: boolean;
    className?: string;
}) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div className={`section${className ? ` ${className}` : ''}`}>
            <button type="button" className="sec-hdr" onClick={() => setOpen(value => !value)}>
                <span>{title}</span>
                <span className={`chevron${open ? ' up' : ''}`}>{'>'}</span>
            </button>
            {open && <div className="sec-body">{children}</div>}
        </div>
    );
}

function Demo() {
    const asciiRef = useRef<VideoAsciiHandle | null>(null);
    const uploadUrlRef = useRef<string | null>(null);
    const [settings, setSettings] = useState<DemoSettings>(initialSettings);
    const [modalOpen, setModalOpen] = useState(true);
    const [activeSource, setActiveSource] = useState(0);
    const [uploadActive, setUploadActive] = useState(false);
    const [uploadedName, setUploadedName] = useState<string | null>(null);
    const [recordingStatus, setRecordingStatus] = useState('ready');
    const [recordingNonce, setRecordingNonce] = useState(0);

    useEffect(() => () => {
        if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    }, []);

    const update = useCallback(<K extends keyof DemoSettings>(key: K, value: DemoSettings[K]) => {
        setSettings(current => ({ ...current, [key]: value }));
    }, []);

    const selectSource = useCallback((index: number) => {
        setActiveSource(index);
        setUploadActive(false);
        update('src', DEMO_SOURCES[index]);
    }, [update]);

    const handleFileSelect = useCallback((file: File) => {
        if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
        const url = URL.createObjectURL(file);
        uploadUrlRef.current = url;
        setUploadedName(file.name);
        setUploadActive(true);
        update('src', url);
    }, [update]);

    const activateUpload = useCallback(() => {
        if (!uploadUrlRef.current) return;
        setUploadActive(true);
        update('src', uploadUrlRef.current);
    }, [update]);

    const startRecording = () => {
        const ok = asciiRef.current?.startRecording({
            fileName: 'video-ascii-export',
            mimeType: settings.exportMimeType,
            frameRate: 30,
            exportScale: settings.exportScale,
            videoBitsPerSecond: settings.exportBitrateMbps * 1_000_000,
        });
        setRecordingStatus(ok ? 'recording' : 'unsupported');
    };

    const stopAndExport = async () => {
        const recording = await asciiRef.current?.stopRecording();
        if (!recording) {
            setRecordingStatus('no recording');
            return;
        }
        asciiRef.current?.downloadRecording(recording, 'video-ascii-export');
        setRecordingStatus(`exported ${recording.extension}`);
    };

    const fixed2 = (value: number) => value.toFixed(2);
    const fixed1 = (value: number) => value.toFixed(1);
    const showExport = (value: MimeType) => value.replace('video/', '');

    return (
        <div className="app">
            <div className="ascii-fill">
                <VideoAscii
                    ref={asciiRef}
                    key={recordingNonce}
                    src={settings.src}
                    videoMode={settings.videoMode}
                    numColsRaw={settings.numColsRaw}
                    brightnessRaw={settings.brightnessRaw}
                    saturationRaw={settings.saturationRaw}
                    bgOpacityRaw={settings.bgOpacityRaw}
                    chars={settings.chars}
                    charMode={settings.charMode}
                    mouseEffect={getMouseEffect(settings)}
                    clickEffect={getClickEffect(settings)}
                    revealEffect={getRevealEffect(settings)}
                    className="ascii-component"
                    recordingOptions={{
                        fileName: 'video-ascii-export',
                        mimeType: settings.exportMimeType,
                        frameRate: 30,
                        exportScale: settings.exportScale,
                        videoBitsPerSecond: settings.exportBitrateMbps * 1_000_000,
                    }}
                    onRecordingStart={type => setRecordingStatus(`recording ${type.replace('video/', '')}`)}
                    onRecordingStop={recording => setRecordingStatus(`ready ${recording.extension}`)}
                    onRecordingError={error => setRecordingStatus(error.message)}
                />
            </div>

            <div className="modal-wrap">
                <button
                    type="button"
                    className={`modal-trigger${modalOpen ? ' is-open' : ''}`}
                    onClick={() => setModalOpen(value => !value)}
                    aria-label="Toggle settings"
                >
                    <span className="trigger-icon icon-sliders"><SlidersIcon /></span>
                    <span className="trigger-icon icon-close"><CloseIcon /></span>
                </button>

                <div className={`modal${modalOpen ? ' open' : ''}`}>
                    <div className="modal-body">
                        <Section title="Video">
                            <ControlRow label="source">
                                <SourcePicker
                                    active={activeSource}
                                    uploadActive={uploadActive}
                                    hasUpload={uploadUrlRef.current !== null}
                                    uploadedName={uploadedName}
                                    onSelect={selectSource}
                                    onFileSelect={handleFileSelect}
                                    onActivateUpload={activateUpload}
                                />
                            </ControlRow>
                            <ControlRow label="video mode">
                                <Toggle value={settings.videoMode} onChange={value => update('videoMode', value)} />
                            </ControlRow>
                        </Section>

                        <Section title="Display">
                            <ControlRow label="columns">
                                <Slider min={20} max={350} step={5} value={settings.numColsRaw} onChange={value => update('numColsRaw', value)} />
                            </ControlRow>
                            <ControlRow label="brightness">
                                <Slider min={0} max={2} step={0.05} value={settings.brightnessRaw} onChange={value => update('brightnessRaw', value)} format={fixed2} />
                            </ControlRow>
                            <ControlRow label="saturation">
                                <Slider min={0} max={2} step={0.05} value={settings.saturationRaw} onChange={value => update('saturationRaw', value)} format={fixed2} />
                            </ControlRow>
                            <ControlRow label="bg opacity">
                                <Slider min={0} max={1} step={0.01} value={settings.bgOpacityRaw} onChange={value => update('bgOpacityRaw', value)} format={fixed2} />
                            </ControlRow>
                        </Section>

                        <Section title="Characters">
                            <ControlStack label="char set">
                                <textarea className="chars-input" value={settings.chars} onChange={event => update('chars', event.target.value)} />
                            </ControlStack>
                            <ControlRow label="char mode">
                                <Segment options={['shape', 'luminance']} value={settings.charMode} onChange={value => update('charMode', value)} />
                            </ControlRow>
                        </Section>

                        <Section title="Mouse" defaultOpen={false}>
                            <ControlRow label="enabled">
                                <Toggle value={settings.mouseEnabled} onChange={value => update('mouseEnabled', value)} />
                            </ControlRow>
                            {settings.mouseEnabled && (
                                <>
                                    <ControlRow label="style">
                                        <Segment options={['brighten', 'scatter']} value={settings.mouseStyle} onChange={value => update('mouseStyle', value)} />
                                    </ControlRow>
                                    <ControlRow label="radius">
                                        <Slider min={0.03} max={0.2} step={0.01} value={settings.mouseRadius} onChange={value => update('mouseRadius', value)} format={fixed2} />
                                    </ControlRow>
                                    <ControlRow label="duration">
                                        <Slider min={0.1} max={4} step={0.1} value={settings.mouseDuration} onChange={value => update('mouseDuration', value)} format={fixed1} />
                                    </ControlRow>
                                    {settings.mouseStyle === 'brighten' && (
                                        <>
                                            <ControlRow label="brightness">
                                                <Slider min={0.2} max={5} step={0.1} value={settings.mouseBrightness} onChange={value => update('mouseBrightness', value)} format={fixed1} />
                                            </ControlRow>
                                            <ControlRow label="trail len">
                                                <Slider min={0} max={30} step={1} value={settings.mouseTrailLen} onChange={value => update('mouseTrailLen', value)} />
                                            </ControlRow>
                                            <ControlRow label="trail decay">
                                                <Slider min={1} max={15} step={0.5} value={settings.mouseTrailDecay} onChange={value => update('mouseTrailDecay', value)} format={fixed1} />
                                            </ControlRow>
                                        </>
                                    )}
                                    {settings.mouseStyle === 'scatter' && (
                                        <ControlStack label="scatter chars">
                                            <input className="text-input" value={settings.mouseScatterChars} onChange={event => update('mouseScatterChars', event.target.value)} />
                                        </ControlStack>
                                    )}
                                </>
                            )}
                        </Section>

                        <Section title="Click" defaultOpen={false}>
                            <ControlRow label="enabled">
                                <Toggle value={settings.clickEnabled} onChange={value => update('clickEnabled', value)} />
                            </ControlRow>
                            {settings.clickEnabled && (
                                <>
                                    <ControlRow label="style">
                                        <Segment options={['ripple', 'spread']} value={settings.clickStyle} onChange={value => update('clickStyle', value)} />
                                    </ControlRow>
                                    {settings.clickStyle === 'ripple' && (
                                        <>
                                            <ControlRow label="brightness">
                                                <Slider min={1.05} max={2} step={0.05} value={settings.clickBrightness} onChange={value => update('clickBrightness', value)} format={fixed2} />
                                            </ControlRow>
                                            <ControlRow label="speed">
                                                <Slider min={0.5} max={4} step={0.1} value={settings.clickSpeed} onChange={value => update('clickSpeed', value)} format={fixed1} />
                                            </ControlRow>
                                        </>
                                    )}
                                    {settings.clickStyle === 'spread' && (
                                        <>
                                            <ControlRow label="duration">
                                                <Slider min={0.5} max={5} step={0.1} value={settings.clickExpandDuration} onChange={value => update('clickExpandDuration', value)} format={fixed1} />
                                            </ControlRow>
                                            <ControlRow label="speed">
                                                <Slider min={0.5} max={10} step={0.25} value={settings.clickSpreadSpeed} onChange={value => update('clickSpreadSpeed', value)} format={fixed2} />
                                            </ControlRow>
                                        </>
                                    )}
                                </>
                            )}
                        </Section>

                        <Section title="Reveal" defaultOpen={false}>
                            <ControlRow label="enabled">
                                <Toggle value={settings.revealEnabled} onChange={value => update('revealEnabled', value)} />
                            </ControlRow>
                            {settings.revealEnabled && (
                                <>
                                    <ControlRow label="type">
                                        <Segment options={['random', 'diagonal', 'radial']} value={settings.revealType} onChange={value => update('revealType', value)} />
                                    </ControlRow>
                                    <ControlRow label="duration">
                                        <Slider min={0.1} max={4} step={0.1} value={settings.revealDuration} onChange={value => update('revealDuration', value)} format={fixed1} />
                                    </ControlRow>
                                    <button type="button" className="retrigger-btn" onClick={() => setRecordingNonce(value => value + 1)}>
                                        retrigger
                                    </button>
                                </>
                            )}
                        </Section>

                        <Section title="Export" className="export-section">
                            <ControlRow label="format">
                                <Segment options={['video/webm', 'video/mp4']} value={settings.exportMimeType} onChange={value => update('exportMimeType', value)} />
                            </ControlRow>
                            <ControlRow label="scale">
                                <Slider min={1} max={4} step={0.5} value={settings.exportScale} onChange={value => update('exportScale', value)} format={fixed1} />
                            </ControlRow>
                            <ControlRow label="bitrate">
                                <Slider min={8} max={40} step={1} value={settings.exportBitrateMbps} onChange={value => update('exportBitrateMbps', value)} format={value => `${value}M`} />
                            </ControlRow>
                            <div className="export-actions">
                                <button type="button" onClick={startRecording}>record</button>
                                <button type="button" onClick={stopAndExport}>stop + export</button>
                            </div>
                            <p className="export-status">{showExport(settings.exportMimeType)} - {recordingStatus}</p>
                        </Section>
                    </div>
                </div>
            </div>
        </div>
    );
}

createRoot(document.getElementById('root')!).render(<Demo />);
