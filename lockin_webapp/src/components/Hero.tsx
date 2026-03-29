import Link from "next/link";
import Logo from "./Logo";

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-white via-lavender to-purple-100 py-24 sm:py-32">
      {/* Decorative blurred circles */}
      <div className="absolute top-20 left-10 w-72 h-72 bg-purple-200 rounded-full blur-3xl opacity-40" />
      <div className="absolute bottom-10 right-20 w-96 h-96 bg-purple-300 rounded-full blur-3xl opacity-30" />

      <div className="relative max-w-7xl mx-auto px-6 text-center">
        <div className="flex justify-center mb-8">
          <Logo size={80} />
        </div>
        <h1 className="text-5xl sm:text-7xl font-bold text-foreground tracking-tight">
          Focus <span className="text-purple-500">Up</span>
        </h1>
        <p className="mt-6 text-xl sm:text-2xl text-foreground/70 max-w-2xl mx-auto">
          Track your attentiveness in real-time. Stay locked in with AI-powered
          insights and analytics.
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/signup"
            className="px-8 py-3 bg-purple-500 text-white text-lg font-semibold rounded-xl hover:bg-purple-600 transition-colors shadow-lg shadow-purple-500/25"
          >
            Get Started Free
          </Link>
          <Link
            href="/#features"
            className="px-8 py-3 border-2 border-purple-300 text-purple-600 text-lg font-semibold rounded-xl hover:bg-purple-100 transition-colors"
          >
            Learn More
          </Link>
        </div>
      </div>
    </section>
  );
}
