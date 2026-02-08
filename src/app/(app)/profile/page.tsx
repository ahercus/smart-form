"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AppHeader } from "@/components/layout";

interface ProfileData {
  firstName: string;
  middleInitial: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

const defaultProfile: ProfileData = {
  firstName: "",
  middleInitial: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  street: "",
  city: "",
  state: "",
  zip: "",
};

export default function ProfilePage() {
  const [saving, setSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileData>(defaultProfile);

  // Load profile data on mount
  useEffect(() => {
    async function loadProfile() {
      try {
        const response = await fetch("/api/profile");
        if (response.ok) {
          const data = await response.json();
          if (data.coreData) {
            setProfile({
              firstName: data.coreData.firstName || "",
              middleInitial: data.coreData.middleInitial || "",
              lastName: data.coreData.lastName || "",
              email: data.coreData.email || "",
              phone: data.coreData.phone || "",
              dateOfBirth: data.coreData.dateOfBirth || "",
              street: data.coreData.street || "",
              city: data.coreData.city || "",
              state: data.coreData.state || "",
              zip: data.coreData.zip || "",
            });
          }
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setProfileLoading(false);
      }
    }
    loadProfile();
  }, []);

  function handleChange(field: keyof ProfileData, value: string) {
    setProfile((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coreData: profile }),
      });

      if (!response.ok) {
        throw new Error("Failed to save profile");
      }

      toast.success("Profile saved");
    } catch (error) {
      console.error("Failed to save profile:", error);
      toast.error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AppHeader>
        <h1 className="text-lg font-semibold">Profile</h1>
      </AppHeader>

      <div className="flex-1 overflow-auto p-2 md:p-6">
        <div className="md:max-w-xl md:mx-auto space-y-6">
          <p className="text-muted-foreground">
            Your information for auto-fill
          </p>

          <form onSubmit={handleSave} className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Personal Information</CardTitle>
                <CardDescription>
                  This information will be used to auto-fill forms
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {profileLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (
                  <>
                    <div className="flex gap-3">
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="firstName">First Name</Label>
                        <Input
                          id="firstName"
                          placeholder="John"
                          value={profile.firstName}
                          onChange={(e) => handleChange("firstName", e.target.value)}
                        />
                      </div>
                      <div className="w-16 space-y-2">
                        <Label htmlFor="middleInitial">M.I.</Label>
                        <Input
                          id="middleInitial"
                          placeholder="A"
                          maxLength={1}
                          className="text-center"
                          value={profile.middleInitial}
                          onChange={(e) => handleChange("middleInitial", e.target.value.toUpperCase())}
                        />
                      </div>
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="lastName">Last Name</Label>
                        <Input
                          id="lastName"
                          placeholder="Doe"
                          value={profile.lastName}
                          onChange={(e) => handleChange("lastName", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="john@example.com"
                          value={profile.email}
                          onChange={(e) => handleChange("email", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone">Phone</Label>
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="(555) 123-4567"
                          value={profile.phone}
                          onChange={(e) => handleChange("phone", e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="dob">Date of Birth</Label>
                      <Input
                        id="dob"
                        type="date"
                        value={profile.dateOfBirth}
                        onChange={(e) => handleChange("dateOfBirth", e.target.value)}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Address</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {profileLoading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="street">Street Address</Label>
                      <Input
                        id="street"
                        placeholder="123 Main St"
                        value={profile.street}
                        onChange={(e) => handleChange("street", e.target.value)}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="city">City</Label>
                        <Input
                          id="city"
                          placeholder="Nashville"
                          value={profile.city}
                          onChange={(e) => handleChange("city", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="state">State</Label>
                        <Input
                          id="state"
                          placeholder="TN"
                          value={profile.state}
                          onChange={(e) => handleChange("state", e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="zip">ZIP Code</Label>
                        <Input
                          id="zip"
                          placeholder="37201"
                          value={profile.zip}
                          onChange={(e) => handleChange("zip", e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Profile"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
