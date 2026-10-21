// Stroke icons on a 24px grid; size and colour follow the surrounding text.
function Icon({ size = 18, strokeWidth = 1.8, className = "", children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const make = (paths) =>
  function NamedIcon(props) {
    return <Icon {...props}>{paths}</Icon>;
  };

export const MediaIcon = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M10 9.2v5.6l4.6-2.8z" />
  </>
);
export const FolderIcon = make(<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z" />);
export const CalendarIcon = make(
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </>
);
export const GearIcon = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>
);
export const LogoutIcon = make(<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />);
export const MenuIcon = make(<path d="M4 7h16M4 12h16M4 17h10" />);
export const SearchIcon = make(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </>
);
export const UploadIcon = make(<path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />);
export const DownloadIcon = make(<path d="M12 4v12m0 0-4.5-4.5M12 16l4.5-4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />);
export const CloseIcon = make(<path d="M6 6l12 12M18 6 6 18" />);
export const CheckIcon = make(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const TrashIcon = make(<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7" />);
export const PencilIcon = make(<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />);
export const ChevronLeftIcon = make(<path d="m15 5-7 7 7 7" />);
export const ChevronRightIcon = make(<path d="m9 5 7 7-7 7" />);
export const ChevronDownIcon = make(<path d="m6 9 6 6 6-6" />);
export const ArrowLeftIcon = make(<path d="M19 12H5m0 0 6-6m-6 6 6 6" />);
export const InfoIcon = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </>
);
export const PlayIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" />
  </svg>
);
export const ImageIcon = make(
  <>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m21 16-5-5-9 9" />
  </>
);
export const MusicIcon = make(
  <>
    <path d="M9 18V5l11-2v13" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </>
);
export const FileIcon = make(<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" />);
export const SelectIcon = make(
  <>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </>
);
export const SunIcon = make(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </>
);
export const MoonIcon = make(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);
export const MonitorIcon = make(
  <>
    <rect x="3" y="4" width="18" height="12.5" rx="2" />
    <path d="M8.5 20h7M12 16.5V20" />
  </>
);
export const InstagramIcon = make(
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="3.8" />
    <path d="M17.2 6.8h.01" />
  </>
);
export const SparkIcon = make(<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.5l-1.9-5.7-5.6-1.9L10.1 9zM19 3v3M17.5 4.5h3" />);
export const AlertIcon = make(
  <>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.2M12 17h.01" />
  </>
);
export const DiamondIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="M7 3h10l4.5 6L12 21 2.5 9z" fill="currentColor" />
    <path d="M2.5 9h19M9.2 3 7.5 9l4.5 12 4.5-12-1.7-6" fill="none" stroke="rgb(255 255 255 / 0.45)" strokeWidth="1" strokeLinejoin="round" />
  </svg>
);
export const SortIcon = make(<path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />);
export const DriveIcon = make(
  <>
    <rect x="3" y="13" width="18" height="7" rx="2" />
    <path d="M5 13 7.5 5h9L19 13M7 16.5h.01" />
  </>
);
export const RefreshIcon = make(<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />);
export const EyeIcon = make(
  <>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </>
);
export const EyeOffIcon = make(<path d="M3 3l18 18M10.6 6.1A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.7 3.4M6.6 7.6A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2" />);
export const WifiOffIcon = make(<path d="M3 3l18 18M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.4M19 12.9a10 10 0 0 0-2.3-1.6M2 9.3a14.5 14.5 0 0 1 4.5-2.8M22 9.3A14.5 14.5 0 0 0 11 5.6M12 20h.01" />);
export const FolderPlusIcon = make(<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5zM12 10.5v5M9.5 13h5" />);
export const MoveIcon = make(<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5zM9 13h6m-2.5-2.5L15 13l-2.5 2.5" />);
export const DotsIcon = make(<path d="M12 6h.01M12 12h.01M12 18h.01" strokeWidth="3" />);
export const PauseIcon = ({ size = 12, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" />
  </svg>
);
export const ReplayIcon = make(<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4v4.5h4.5" />);
export const BackTenIcon = make(
  <>
    <path d="M12 4.5A7.5 7.5 0 1 1 4.5 12M12 4.5 9 2m3 2.5L9 7" />
    <text x="12.2" y="15.4" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">10</text>
  </>
);
export const ForwardTenIcon = make(
  <>
    <path d="M12 4.5A7.5 7.5 0 1 0 19.5 12M12 4.5 15 2m-3 2.5L15 7" />
    <text x="11.8" y="15.4" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">10</text>
  </>
);
export const VolumeIcon = make(<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />);
export const MuteIcon = make(<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16.5 9.5l5 5m0-5-5 5" />);
export const ExpandIcon = make(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />);
export const ShrinkIcon = make(<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />);
export const SpeedIcon = make(<path d="M4.5 16.5a8 8 0 1 1 15 0M12 12.5l3.5-3.5M12 13.5h.01" />);
export const ScissorsIcon = make(
  <>
    <circle cx="6.5" cy="6.5" r="2.8" />
    <circle cx="6.5" cy="17.5" r="2.8" />
    <path d="M8.8 8.2 20 18M8.8 15.8 20 6" />
  </>
);
export const StarIcon = make(<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />);
export const StarFilledIcon = ({ size = 18, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
export const CopyIcon = make(
  <>
    <rect x="8" y="8" width="12" height="12" rx="2.5" />
    <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
  </>
);
export const RotateRightIcon = make(<path d="M15 4.5h4.5V9M19.3 4.8A8 8 0 1 0 20 12" />);
export const RotateLeftIcon = make(<path d="M9 4.5H4.5V9M4.7 4.8A8 8 0 1 1 4 12" />);
export const FlipIcon = make(<path d="M12 3v18M9 6.5 4 18h5zM15 6.5 20 18h-5z" />);
export const ArchiveIcon = make(
  <>
    <rect x="3.5" y="4" width="17" height="5" rx="1.5" />
    <path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4" />
  </>
);
export const PlaneIcon = make(<path d="M10.5 13.5 4 12l1-2 6 .5L15.5 5c1-1 2.6-1.2 3.3-.5s.5 2.3-.5 3.3l-5.3 4.5.5 6-2 1-1.5-6.5-3.5 3V17l-2.5 1.5L4 18l1.5-1.5 2-2.5" />);
export const TrainIcon = make(
  <>
    <rect x="5" y="3.5" width="14" height="13" rx="3" />
    <path d="M5 11h14M9 20l-2 1.5M15 20l2 1.5M8.5 14h.01M15.5 14h.01M9 16.5 7.5 20h9L15 16.5" />
  </>
);
export const BusIcon = make(
  <>
    <rect x="4" y="3.5" width="16" height="14" rx="3" />
    <path d="M4 10.5h16M7.5 14h.01M16.5 14h.01M7 17.5v2.5M17 17.5v2.5" />
  </>
);
export const CarIcon = make(<path d="M5 16.5v2M19 16.5v2M3.5 12.5 5.5 7a2 2 0 0 1 1.9-1.5h9.2A2 2 0 0 1 18.5 7l2 5.5M3.5 12.5h17v4h-17zM7 14.5h.01M17 14.5h.01" />);
export const ShipIcon = make(<path d="M4 15.5 3 19.5c3 1 6 1 9-.5 3 1.5 6 1.5 9 .5l-1-4M5 15l7-3 7 3M8 13V8h8v5M12 5v3" />);
export const BikeIcon = make(
  <>
    <circle cx="6" cy="16" r="3.5" />
    <circle cx="18" cy="16" r="3.5" />
    <path d="M6 16 9.5 9h5l3.5 7M9.5 9 12 16h3.5M13 6h3" />
  </>
);
export const BedIcon = make(<path d="M3 18.5V7M3 15h18v3.5M21 15v-3.5a3 3 0 0 0-3-3h-7v6.5M7 11.5h.01" />);
export const PinIcon = make(
  <>
    <path d="M12 21s-6.5-5.5-6.5-11a6.5 6.5 0 1 1 13 0c0 5.5-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </>
);
export const FoodIcon = make(<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3.5 3.5-3.5 7v3H17" />);
export const NoteIcon = make(<path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20zM14.5 3.5V8H19M9 12h6M9 15.5h4" />);
export const WalletIcon = make(<path d="M4 7.5V18a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1v-3M4 7.5A2.5 2.5 0 0 1 6.5 5H17v2.5M4 7.5h15a1 1 0 0 1 1 1V11M20 11h-4a2.5 2.5 0 0 0 0 5h4z" />);
export const TicketIcon = make(<path d="M3.5 8.5V6.5A1.5 1.5 0 0 1 5 5h14a1.5 1.5 0 0 1 1.5 1.5v2a3.5 3.5 0 0 0 0 7v2A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-2a3.5 3.5 0 0 0 0-7zM14 5v2M14 11v2M14 17v2" />);
export const ClipIcon = make(<path d="m20 11.5-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.7 1.7 0 0 1-2.4-2.4L15 7" />);
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);
export const UsersIcon = make(
  <>
    <circle cx="9" cy="8.5" r="3.3" />
    <path d="M3 19.5a6 6 0 0 1 12 0M16 5.5a3.3 3.3 0 0 1 0 6.2M18 19.5a6 6 0 0 0-2.5-4.9" />
  </>
);
export const ChecklistIcon = make(<path d="m4 7 2 2 3.5-3.5M4 15l2 2 3.5-3.5M12.5 8h7.5M12.5 16h7.5" />);
export const ClockIcon = make(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>
);
export const MapIcon = make(<path d="m9 4.5-5 2v13l5-2 6 2 5-2v-13l-5 2zM9 4.5v13M15 6.5v13" />);
