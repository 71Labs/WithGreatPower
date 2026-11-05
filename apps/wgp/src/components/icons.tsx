/**
 * Every icon in Vessel comes from Hugeicons (free Stroke Rounded set). Components are
 * exported under the names the app already uses, so a page imports from here and never
 * from an icon package directly. Size with Tailwind (`size-4`); color follows
 * `currentColor`; stroke defaults to 1.5 to match the set.
 */
import { forwardRef, type ComponentProps } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Alert02Icon,
  AlertCircleIcon,
  ArrowDataTransferHorizontalIcon,
  ArrowDown01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  BankIcon,
  Calendar03Icon,
  Calendar04Icon,
  Cancel01Icon,
  CancelCircleIcon,
  CheckmarkBadge01Icon,
  Clock01Icon,
  Coins01Icon,
  CompassIcon,
  Copy01Icon,
  DashboardSpeed01Icon,
  DashedLineCircleIcon,
  EditOffIcon,
  File02Icon,
  FileRemoveIcon,
  FilterHorizontalIcon,
  Globe02Icon,
  HourglassIcon,
  Invoice01Icon,
  Invoice03Icon,
  Key01Icon,
  Layers01Icon,
  LegalDocument01Icon,
  Link02Icon,
  LinkSquare02Icon,
  Logout01Icon,
  Menu01Icon,
  MoneyReceiveSquareIcon,
  PencilEdit02Icon,
  PercentIcon,
  PrinterIcon,
  SecurityCheckIcon,
  SourceCodeIcon,
  SparklesIcon,
  SquareLock02Icon,
  StampIcon,
  Store01Icon,
  Tag01Icon,
  Tick02Icon,
  Timer02Icon,
  TransactionHistoryIcon,
  UnavailableIcon,
  Undo02Icon,
  UserCheck01Icon,
  UserGroupIcon,
  UserRemove01Icon,
  ViewOffIcon,
  Wallet01Icon,
  Wallet02Icon,
  FlashIcon,
  Sword03Icon,
  Target02Icon,
  Award01Icon,
  MapsLocation01Icon,
  MapsIcon,
  News01Icon,
  TShirtIcon,
  GameController03Icon,
  FavouriteIcon,
  Rocket01Icon,
  City01Icon,
  Megaphone01Icon,
  Medal01Icon,
  VoteIcon,
  HandshakeIcon,
  Building03Icon,
  UserMultipleIcon,
  Moon02Icon,
  HelpCircleIcon,
  Settings02Icon,
  GoogleIcon,
  Login03Icon,
  UserCircleIcon,
  TestTube01Icon,
  MinusSignIcon,
  PlusSignIcon,
  ChartLineData01Icon,
  PlayIcon,
  PauseIcon,
  RefreshIcon,
  GithubIcon,
  HeadphonesIcon,
  FireIcon,
  SmartPhone01Icon,
  ReplayIcon,
  NewTwitterIcon,
  Download04Icon,
  Search01Icon,
  Folder01Icon,
  FolderSearch01Icon,
  Camera01Icon,
  Cursor01Icon,
} from "@hugeicons/core-free-icons";

export type IconProps = Omit<ComponentProps<"svg">, "ref"> & { strokeWidth?: number; size?: number | string };
export type Icon = ReturnType<typeof make>;

function make(svg: IconSvgElement, name: string) {
  const Component = forwardRef<SVGSVGElement, IconProps>(function HugeIcon({ strokeWidth = 1.5, size = 24, ...props }, ref) {
    return <HugeiconsIcon ref={ref} icon={svg} size={size} strokeWidth={strokeWidth} color="currentColor" {...props} />;
  });
  Component.displayName = name;
  return Component;
}

export const AlertTriangle = make(Alert02Icon, "AlertTriangle");
export const ArrowLeft = make(ArrowLeft02Icon, "ArrowLeft");
export const ArrowLeftRight = make(ArrowDataTransferHorizontalIcon, "ArrowLeftRight");
export const ArrowRight = make(ArrowRight02Icon, "ArrowRight");
export const ArrowUpRight = make(ArrowUpRight01Icon, "ArrowUpRight");
export const BadgeCheck = make(CheckmarkBadge01Icon, "BadgeCheck");
export const Ban = make(UnavailableIcon, "Ban");
export const CalendarClock = make(Calendar04Icon, "CalendarClock");
export const CalendarDays = make(Calendar03Icon, "CalendarDays");
export const Check = make(Tick02Icon, "Check");
export const ChevronDown = make(ArrowDown01Icon, "ChevronDown");
export const ChevronRight = make(ArrowRight01Icon, "ChevronRight");
export const CircleAlert = make(AlertCircleIcon, "CircleAlert");
export const CircleDashed = make(DashedLineCircleIcon, "CircleDashed");
export const CircleSlash = make(CancelCircleIcon, "CircleSlash");
export const Clock = make(Clock01Icon, "Clock");
export const Code = make(SourceCodeIcon, "Code");
export const Coins = make(Coins01Icon, "Coins");
export const Copy = make(Copy01Icon, "Copy");
export const ExternalLink = make(LinkSquare02Icon, "ExternalLink");
export const EyeOff = make(ViewOffIcon, "EyeOff");
export const FileText = make(File02Icon, "FileText");
export const FileX = make(FileRemoveIcon, "FileX");
export const Gauge = make(DashboardSpeed01Icon, "Gauge");
export const Globe = make(Globe02Icon, "Globe");
export const HandCoins = make(MoneyReceiveSquareIcon, "HandCoins");
export const History = make(TransactionHistoryIcon, "History");
export const Hourglass = make(HourglassIcon, "Hourglass");
export const KeyRound = make(Key01Icon, "KeyRound");
export const Landmark = make(BankIcon, "Landmark");
export const Layers = make(Layers01Icon, "Layers");
export const Link2 = make(Link02Icon, "Link2");
export const Lock = make(SquareLock02Icon, "Lock");
export const LogOut = make(Logout01Icon, "LogOut");
export const Menu = make(Menu01Icon, "Menu");
export const PenLine = make(PencilEdit02Icon, "PenLine");
export const PenOff = make(EditOffIcon, "PenOff");
export const Percent = make(PercentIcon, "Percent");
export const Printer = make(PrinterIcon, "Printer");
export const Receipt = make(Invoice01Icon, "Receipt");
export const ReceiptText = make(Invoice03Icon, "ReceiptText");
export const ScrollText = make(LegalDocument01Icon, "ScrollText");
export const ShieldCheck = make(SecurityCheckIcon, "ShieldCheck");
export const SlidersHorizontal = make(FilterHorizontalIcon, "SlidersHorizontal");
export const Sparkles = make(SparklesIcon, "Sparkles");
export const Stamp = make(StampIcon, "Stamp");
export const Store = make(Store01Icon, "Store");
export const Tag = make(Tag01Icon, "Tag");
export const Timer = make(Timer02Icon, "Timer");
export const TriangleAlert = AlertTriangle;
export const Undo2 = make(Undo02Icon, "Undo2");
export const UserCheck = make(UserCheck01Icon, "UserCheck");
export const UserX = make(UserRemove01Icon, "UserX");
export const Users = make(UserGroupIcon, "Users");
export const Wallet = make(Wallet01Icon, "Wallet");
export const WalletMinimal = make(Wallet02Icon, "WalletMinimal");
export const X = make(Cancel01Icon, "X");

export const Zap = make(FlashIcon, "Zap");
export const Swords = make(Sword03Icon, "Swords");
export const Target = make(Target02Icon, "Target");
export const Award = make(Award01Icon, "Award");
export const MapPin = make(MapsLocation01Icon, "MapPin");
export const MapIcon = make(MapsIcon, "MapIcon");
export const Compass = make(CompassIcon, "Compass");
export const Newspaper = make(News01Icon, "Newspaper");
export const Shirt = make(TShirtIcon, "Shirt");
export const Gamepad = make(GameController03Icon, "Gamepad");
export const Heart = make(FavouriteIcon, "Heart");
export const Rocket = make(Rocket01Icon, "Rocket");
export const City = make(City01Icon, "City");
export const Megaphone = make(Megaphone01Icon, "Megaphone");
export const Medal = make(Medal01Icon, "Medal");
export const Vote = make(VoteIcon, "Vote");
export const Handshake = make(HandshakeIcon, "Handshake");
export const Building = make(Building03Icon, "Building");
export const UsersRound = make(UserMultipleIcon, "UsersRound");
export const Moon = make(Moon02Icon, "Moon");
export const HelpCircle = make(HelpCircleIcon, "HelpCircle");
export const Settings = make(Settings02Icon, "Settings");
export const Google = make(GoogleIcon, "Google");
export const LogIn = make(Login03Icon, "LogIn");
export const UserCircle = make(UserCircleIcon, "UserCircle");
export const TestTube = make(TestTube01Icon, "TestTube");
export const Minus = make(MinusSignIcon, "Minus");
export const Plus = make(PlusSignIcon, "Plus");
export const ChartLine = make(ChartLineData01Icon, "ChartLine");
export const Play = make(PlayIcon, "Play");
export const Pause = make(PauseIcon, "Pause");
export const RotateCcw = make(RefreshIcon, "RotateCcw");
export const Github = make(GithubIcon, "Github");
export const Headphones = make(HeadphonesIcon, "Headphones");
export const Flame = make(FireIcon, "Flame");
export const Smartphone = make(SmartPhone01Icon, "Smartphone");
export const Replay = make(ReplayIcon, "Replay");
/** The X (Twitter) logo. */
export const XLogo = make(NewTwitterIcon, "XLogo");
export const Download = make(Download04Icon, "Download");
export const Search = make(Search01Icon, "Search");
export const Folder = make(Folder01Icon, "Folder");
export const FolderSearch = make(FolderSearch01Icon, "FolderSearch");
export const Camera = make(Camera01Icon, "Camera");
export const Cursor = make(Cursor01Icon, "Cursor");

/** Lucide's `LucideIcon` type, for components that take an icon as a prop. */
export type LucideIcon = Icon;
