"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export default function ProfilePage() {
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    // TODO: Implement profile save
    await new Promise((resolve) => setTimeout(resolve, 1000));

    toast.success("Profile saved");
    setSaving(false);
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          Manage your information for auto-fill
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Personal Information</CardTitle>
            <CardDescription>
              This information will be used to auto-fill forms
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" placeholder="John Doe" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" placeholder="john@example.com" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" type="tel" placeholder="(555) 123-4567" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob">Date of Birth</Label>
                <Input id="dob" type="date" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="street">Street Address</Label>
              <Input id="street" placeholder="123 Main St" />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input id="city" placeholder="Nashville" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">State</Label>
                <Input id="state" placeholder="TN" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip">ZIP Code</Label>
                <Input id="zip" placeholder="37201" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Additional Context</CardTitle>
            <CardDescription>
              Add any additional information that might help with auto-fill
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="E.g., I have two children: Emma (7) and Jack (4). My employer is Acme Corp. My insurance provider is BlueCross, policy #BC123456."
              rows={4}
            />
          </CardContent>
        </Card>

        <Separator />

        <div className="flex justify-end">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Profile"}
          </Button>
        </div>
      </form>
    </div>
  );
}
