import { AuthForm } from "@/features/auth/auth-form";

export default function SignupPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <AuthForm mode="signup" />
    </main>
  );
}
