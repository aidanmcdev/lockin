import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="bg-foreground text-white py-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="bg-white rounded-lg p-1">
              <Logo size={28} />
            </div>
            <span className="text-lg font-bold">Focus Up</span>
          </div>
          <p className="text-sm text-white/50">
            &copy; {new Date().getFullYear()} Focus Up. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
