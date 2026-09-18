"use client";

import { useEffect, useState, useCallback } from "react";
import { signOut } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  LogOut,
  RefreshCw,
  Package,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  MapPin,
  Building2,
} from "lucide-react";

type AppRole = "MANAGER" | "SPV" | "HUB_LEAD";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: AppRole;
  hubIds: string[];
  clusterIds: string[];
};

type Hub = { id: string; name: string; clusterId: string; clusterName: string };
type Cluster = { id: string; name: string };

type MetricRow = {
  hourTimestamp: string;
  hour: number;
  label: string;
  inbound: number;
  outbound: number;
  delivered: number;
  pending: number;
  slaBreach: number;
  activeCouriers: number;
};

type MetricsResponse = {
  data: MetricRow[];
  totals: {
    inbound: number;
    outbound: number;
    delivered: number;
    pending: number;
    slaBreach: number;
    activeCouriers: number;
  };
  hubCount: number;
};

export default function DashboardView({ user }: { user: SessionUser }) {
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<string>("all");
  const [selectedHub, setSelectedHub] = useState<string>("all");
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const isManager = user.role === "MANAGER";
  const isSpv = user.role === "SPV";
  const isHubLead = user.role === "HUB_LEAD";

  useEffect(() => {
    fetch("/api/hubs")
      .then((r) => r.json())
      .then((d) => {
        setHubs(d.hubs || []);
        setClusters(d.clusters || []);
        if (isHubLead && d.hubs?.length === 1) {
          setSelectedHub(d.hubs[0].id);
        }
      })
      .catch((e) => console.error("Failed to load hubs:", e));
  }, [isHubLead]);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedHub !== "all") params.set("hubId", selectedHub);
      const res = await fetch(`/api/metrics/hourly?${params}`);
      const data = await res.json();
      setMetrics(data);
      setLastUpdate(new Date());
    } catch (e) {
      console.error("Failed to load metrics:", e);
    } finally {
      setLoading(false);
    }
  }, [selectedHub]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  useEffect(() => {
    const t = setInterval(() => fetchMetrics(), 30000);
    return () => clearInterval(t);
  }, [fetchMetrics]);

  const filteredHubs =
    isManager && selectedCluster !== "all"
      ? hubs.filter((h) => h.clusterId === selectedCluster)
      : hubs;

  const totals = metrics?.totals;

  const roleBadgeColor = {
    MANAGER: "bg-purple-100 text-purple-700 border-purple-200",
    SPV: "bg-blue-100 text-blue-700 border-blue-200",
    HUB_LEAD: "bg-green-100 text-green-700 border-green-200",
  }[user.role];

  const selectedHubName =
    selectedHub === "all"
      ? "Semua Hub"
      : hubs.find((h) => h.id === selectedHub)?.name ?? "-";

  const selectedClusterName =
    selectedCluster === "all"
      ? "Semua Cluster"
      : clusters.find((c) => c.id === selectedCluster)?.name ?? "Semua Cluster";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-green-600 rounded-lg flex items-center justify-center">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">
                Goto Logistik
              </h1>
              <p className="text-xs text-gray-500">
                Hourly Delivery Monitoring
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900">{user.name}</p>
              <p className="text-xs text-gray-500">{user.email}</p>
            </div>
            <span
              className={`text-xs font-medium px-2.5 py-1 rounded-full border ${roleBadgeColor}`}
            >
              {user.role}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              <LogOut className="w-4 h-4 mr-1.5" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          {isManager && (
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-400" />
              <Select
                value={selectedCluster}
                onValueChange={(v) => {
                  setSelectedCluster(v ?? "all");
                  setSelectedHub("all");
                }}
              >
                <SelectTrigger className="w-[200px] bg-white">
                  <SelectValue placeholder="Pilih Cluster">
                    {selectedClusterName}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Cluster</SelectItem>
                  {clusters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(isManager || isSpv) && (
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-400" />
              <Select
                value={selectedHub}
                onValueChange={(v) => setSelectedHub(v ?? "all")}
              >
                <SelectTrigger className="w-[240px] bg-white">
                  <SelectValue placeholder="Pilih Hub">
                    {selectedHubName}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Hub</SelectItem>
                  {filteredHubs.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {isHubLead && (
            <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-md px-3 py-2">
              <MapPin className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium text-gray-700">
                {selectedHubName}
              </span>
            </div>
          )}

          <div className="ml-auto flex items-center gap-3">
            {lastUpdate && (
              <span className="text-xs text-gray-400">
                Update: {lastUpdate.toLocaleTimeString("id-ID")}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={fetchMetrics}
              disabled={loading}
            >
              <RefreshCw
                className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard
            label="Inbound"
            value={totals?.inbound ?? 0}
            icon={<Package className="w-4 h-4" />}
            color="blue"
          />
          <KpiCard
            label="Outbound"
            value={totals?.outbound ?? 0}
            icon={<Truck className="w-4 h-4" />}
            color="indigo"
          />
          <KpiCard
            label="Delivered"
            value={totals?.delivered ?? 0}
            icon={<CheckCircle2 className="w-4 h-4" />}
            color="green"
          />
          <KpiCard
            label="Pending"
            value={totals?.pending ?? 0}
            icon={<Clock className="w-4 h-4" />}
            color="amber"
          />
          <KpiCard
            label="SLA Breach"
            value={totals?.slaBreach ?? 0}
            icon={<AlertTriangle className="w-4 h-4" />}
            color="red"
          />
          <KpiCard
            label="Kurir Aktif"
            value={totals?.activeCouriers ?? 0}
            icon={<Users className="w-4 h-4" />}
            color="purple"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Hourly Delivery — 24 Jam Terakhir
            </CardTitle>
            <p className="text-xs text-gray-500">
              {selectedHubName}
              {metrics?.hubCount !== undefined && ` · ${metrics.hubCount} hub`}
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] w-full">
              {metrics?.data && metrics.data.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metrics.data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "#6b7280" }}
                    />
                    <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid #e5e7eb",
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="inbound"
                      name="Inbound"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="outbound"
                      name="Outbound"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="delivered"
                      name="Delivered"
                      stroke="#22c55e"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="pending"
                      name="Pending"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-gray-400">
                  {loading ? "Memuat data..." : "Tidak ada data"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">
                Perbandingan Inbound vs Outbound vs Delivered
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                {metrics?.data && metrics.data.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metrics.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "#6b7280" }}
                      />
                      <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 8,
                          border: "1px solid #e5e7eb",
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="inbound"
                        name="Inbound"
                        fill="#3b82f6"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="outbound"
                        name="Outbound"
                        fill="#6366f1"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="delivered"
                        name="Delivered"
                        fill="#22c55e"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-400">
                    {loading ? "Memuat data..." : "Tidak ada data"}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status SLA</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">SLA Breach</span>
                <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                  {totals?.slaBreach ?? 0} paket
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Pending</span>
                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                  {totals?.pending ?? 0} paket
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Delivered</span>
                <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                  {totals?.delivered ?? 0} paket
                </Badge>
              </div>

              <div className="pt-4 border-t">
                <p className="text-xs text-gray-500 mb-2">Success Rate</p>
                <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-green-500 h-full transition-all"
                    style={{
                      width: `${
                        totals && totals.delivered + totals.pending > 0
                          ? (totals.delivered /
                              (totals.delivered + totals.pending)) *
                            100
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <p className="text-right text-xs text-gray-500 mt-1">
                  {totals && totals.delivered + totals.pending > 0
                    ? (
                        (totals.delivered /
                          (totals.delivered + totals.pending)) *
                        100
                      ).toFixed(1)
                    : "0.0"}
                  %
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Detail Per Jam</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Jam</TableHead>
                    <TableHead className="text-right">Inbound</TableHead>
                    <TableHead className="text-right">Outbound</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="text-right">SLA Breach</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics?.data && metrics.data.length > 0 ? (
                    metrics.data.map((row) => (
                      <TableRow key={row.hourTimestamp}>
                        <TableCell className="font-medium">
                          {row.label}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.inbound}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.outbound}
                        </TableCell>
                        <TableCell className="text-right text-green-600 font-medium">
                          {row.delivered}
                        </TableCell>
                        <TableCell className="text-right text-amber-600">
                          {row.pending}
                        </TableCell>
                        <TableCell className="text-right text-red-600 font-medium">
                          {row.slaBreach}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-gray-400 py-8"
                      >
                        {loading ? "Memuat data..." : "Tidak ada data"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "blue" | "indigo" | "green" | "amber" | "red" | "purple";
}) {
  const colorMap = {
    blue: "bg-blue-50 text-blue-600",
    indigo: "bg-indigo-50 text-indigo-600",
    green: "bg-green-50 text-green-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    purple: "bg-purple-50 text-purple-600",
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500">{label}</span>
          <div className={`p-1.5 rounded-md ${colorMap[color]}`}>{icon}</div>
        </div>
        <p className="text-2xl font-semibold text-gray-900">
          {value.toLocaleString("id-ID")}
        </p>
      </CardContent>
    </Card>
  );
}