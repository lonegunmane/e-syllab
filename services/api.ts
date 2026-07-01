const API_BASE_URL = "/api";

export async function login(email: string, password: string) {
  const response = await fetch(`${API_BASE_URL}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  if (!response.ok) {
    throw new Error("Login failed");
  }

  return response.json();
}

export async function getProfile() {
  const response = await fetch(`${API_BASE_URL}/profile`);

  if (!response.ok) {
    throw new Error("Failed to load profile");
  }

  return response.json();
}
