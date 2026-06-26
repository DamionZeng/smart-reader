import { LoginForm } from "@/components/auth/login-form";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#F9F8F6] text-[#1C1C1C] font-sans">
      <nav className="fixed top-0 w-full bg-[#F9F8F6]/90 backdrop-blur z-50 border-b border-[#1C1C1C]/10 px-6 py-5">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <Link
            href="/"
            className="font-serif text-2xl tracking-tight font-bold"
          >
            SmartReader.
          </Link>
        </div>
      </nav>

      <main className="min-h-screen flex items-center justify-center px-6 py-32">
        <LoginForm />
      </main>
    </div>
  );
}
