export type AttendanceStatus = "present" | "absent" | "on_leave";

export type SerializedTimestamp = {
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
};

export interface Attendance {
  id: string;
  employeeId: string;
  branchId: string;
  date: string;
  status: AttendanceStatus;
  note?: string;
  createdAt?: SerializedTimestamp | string | null;
  updatedAt?: SerializedTimestamp | string | null;
}
