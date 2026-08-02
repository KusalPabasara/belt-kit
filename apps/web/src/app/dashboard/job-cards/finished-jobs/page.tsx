"use client";

import { useMemo } from "react";
import Link from "next/link";

import {
  ClipboardCheck,
  Car,
  User,
  CalendarCheck,
  ShieldCheck,
} from "lucide-react";

import { useCollection } from "@/lib/useCollection";

import {
  JobCard,
  Customer,
  Vehicle,
  ServiceType,
  InsuranceClaim,
} from "@/lib/models";

import {
  PageHeader,
  EmptyState,
  Badge,
} from "@/components/ui";

import {
  formatDate,
  formatMoney,
} from "@/lib/format";



export default function FinishedJobsPage() {


const {data:jobs,loading}=useCollection<JobCard>(
 "jobCards"
);


const {data:customers}=useCollection<Customer>(
 "customers"
);


const {data:vehicles}=useCollection<Vehicle>(
 "vehicles"
);


const {data:services}=useCollection<ServiceType>(
 "services"
);

const {data:insuranceClaims}=useCollection<InsuranceClaim>(
 "insuranceClaims"
);

const finishedJobs = useMemo(()=>{

return jobs
.filter(
 j =>
 j.status === "delivered" &&
 !j.archived
)
.sort(
(a,b)=>
(b.actualEndDate?.toMillis() ?? 0)
-
(a.actualEndDate?.toMillis() ?? 0)
);


},[jobs]);





function customerName(id:string){

return (
customers.find(c=>c.id===id)
?.displayName
??
"-"
);

}





function vehicleName(id:string){

const vehicle =
vehicles.find(
v=>v.id===id
);


return vehicle
?
`${vehicle.make} ${vehicle.model} · ${vehicle.plateNumber}`
:
"-";

}





function serviceNames(ids?:string[]){

return services
.filter(
s=>(ids ?? []).includes(s.id)
)
.map(
s=>s.name
)
.join(", ")
||
"-";

}


function insuranceClaimForJob(jobId:string){

  return insuranceClaims.find(
    claim =>
      claim.jobCardId === jobId
  );

}


return (

<div className="mx-auto max-w-7xl">


<PageHeader

eyebrow="Operations"

title="Finished Jobs"

icon={ClipboardCheck}

/>




{
loading ?

<p>
Loading...
</p>



:

finishedJobs.length===0 ?


<EmptyState

icon={ClipboardCheck}

title="No finished jobs"

hint="Delivered jobs will appear here."

/>



:


<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">


{
finishedJobs.map(job=>(


<div

key={job.id}

className="card p-5 hover:shadow-luxe"

>



<Link

href={`/dashboard/job-cards/${job.id}`}

className="block"

>



<div className="flex justify-between">


<Badge tone="burgundy">

Delivered

</Badge>


</div>




<h3 className="mt-3 font-semibold">

{job.complaint}

</h3>





<div className="mt-3 space-y-2 text-sm text-ink-soft">


<p className="flex gap-2">

<User size={15}/>

{customerName(job.customerId)}

</p>




<p className="flex gap-2">

<Car size={15}/>

{vehicleName(job.vehicleId)}

</p>





<p>

🔧 {serviceNames(job.serviceTypeIds)}

</p>





<p className="flex gap-2">


<CalendarCheck size={15}/>


Completed:

{" "}

{
job.actualEndDate

?

formatDate(job.actualEndDate)

:

"-"

}


</p>





<p className="font-semibold text-ink">

Final Bill:

{" "}

{
formatMoney(job.totalMinor)
}

</p>




</div>


</Link>





{
  insuranceClaimForJob(job.id ?? "")
  ?

  <Link

    href={`/dashboard/insurance/${insuranceClaimForJob(job.id ?? "")?.id}`}

    className="
      mt-5
      flex
      items-center
      justify-center
      gap-2
      rounded-xl
      border
      border-green-300
      px-3
      py-2
      text-sm
      text-green-700
      transition
      hover:bg-green-50
    "

  >

    <ShieldCheck size={15}/>

    View Insurance Claim

  </Link>


  :


  <Link

    href={`/dashboard/insurance/create?jobId=${job.id}`}

    className="
      mt-5
      flex
      items-center
      justify-center
      gap-2
      rounded-xl
      border
      border-burgundy-300
      px-3
      py-2
      text-sm
      text-burgundy-700
      transition
      hover:bg-burgundy-50
    "

  >

    <ShieldCheck size={15}/>

    Add Insurance Claim

  </Link>

}





</div>


))

}


</div>


}



</div>


)

}