"use client";

import { useMemo } from "react";
import Link from "next/link";

import {
  ShieldCheck,
  Car,
  User,
  CalendarCheck,
  Pencil,
  Eye,
} from "lucide-react";

import { useCollection } from "@/lib/useCollection";

import {
  InsuranceClaim,
  Customer,
  Vehicle,
  JobCard,
} from "@/lib/models";

import {
  PageHeader,
  EmptyState,
  Badge,
} from "@/components/ui";

import {
  formatMoney,
  formatDate,
} from "@/lib/format";


export default function InsurancePage() {


  const {
    data: claims,
    loading,
  } = useCollection<InsuranceClaim>(
    "insuranceClaims"
  );


  const {
    data: customers,
  } = useCollection<Customer>(
    "customers"
  );


  const {
    data: vehicles,
  } = useCollection<Vehicle>(
    "vehicles"
  );


  const {
    data: jobs,
  } = useCollection<JobCard>(
    "jobCards"
  );



  const sortedClaims = useMemo(() => {

    return [...claims].sort(
      (a,b) =>
        (b.createdAt?.toMillis?.() ?? 0)
        -
        (a.createdAt?.toMillis?.() ?? 0)
    );

  },[claims]);




  function customerName(id:string){

    return (
      customers.find(
        c => c.id === id
      )
      ?.displayName
      ??
      "-"
    );

  }



  function vehicleName(id:string){

    const vehicle =
      vehicles.find(
        v => v.id === id
      );


    return vehicle
      ?
      `${vehicle.make} ${vehicle.model} · ${vehicle.plateNumber}`
      :
      "-";

  }



  function jobTitle(id:string){

    return (
      jobs.find(
        j => j.id === id
      )
      ?.complaint
      ??
      "-"
    );

  }




  function statusTone(
    status: InsuranceClaim["status"]
  ){

    switch(status){

      case "received":
        return "green";

      case "approved":
        return "blue";

      case "rejected":
        return "neutral";

      default:
        return "amber";

    }

  }




  return (

    <div className="mx-auto max-w-7xl">


      <PageHeader

        eyebrow="Finance"

        title="Insurance Claims"

        icon={ShieldCheck}

        action={

          <Link

            href="/dashboard/job-cards/finished-jobs"

            className="btn-primary"

          >

            Add From Finished Job

          </Link>

        }

      />





      {
        loading ? (

          <p className="p-6">
            Loading insurance claims...
          </p>

        )

        :

        sortedClaims.length === 0 ? (

          <EmptyState

            icon={ShieldCheck}

            title="No insurance claims"

            hint="Create an insurance claim from a finished job."

          />

        )

        :

        (

          <div className="
            grid
            gap-4
            md:grid-cols-2
            lg:grid-cols-3
          ">


            {
              sortedClaims.map(
                claim => (

                  <div

                    key={claim.id}

                    className="
                      card
                      p-5
                      transition
                      hover:shadow-luxe
                    "

                  >




                    <div className="flex justify-between items-center">


                      <Badge

                        tone={
                          statusTone(
                            claim.status
                          )
                        }

                      >

                        {claim.status.toUpperCase()}

                      </Badge>



                    </div>





                    <h3 className="
                      mt-4
                      text-lg
                      font-semibold
                      text-ink
                    ">

                      {claim.companyName}

                    </h3>





                    <div className="
                      mt-4
                      space-y-3
                      text-sm
                      text-ink-soft
                    ">




                      <p className="flex gap-2">

                        <User size={15}/>

                        {
                          customerName(
                            claim.customerId
                          )
                        }

                      </p>





                      <p className="flex gap-2">

                        <Car size={15}/>

                        {
                          vehicleName(
                            claim.vehicleId
                          )
                        }

                      </p>






                      <p>

                        Job:

                        {" "}

                        {
                          jobTitle(
                            claim.jobCardId
                          )
                        }

                      </p>






                      <p className="flex gap-2">

                        <CalendarCheck size={15}/>

                        Created:

                        {" "}

                        {
                          claim.createdAt
                          ?
                          formatDate(
                            claim.createdAt
                          )
                          :
                          "-"
                        }

                      </p>






                      <div className="
                        border-t
                        border-line
                        pt-3
                        space-y-2
                      ">



                        <div className="flex justify-between">

                          <span>
                            Claim Amount
                          </span>


                          <span className="font-semibold text-ink">

                            {
                              formatMoney(
                                claim.claimAmountMinor
                              )
                            }

                          </span>

                        </div>





                        <div className="flex justify-between">

                          <span>
                            Received
                          </span>


                          <span className="font-semibold">

                            {
                              formatMoney(
                                claim.receivedAmountMinor
                              )
                            }

                          </span>


                        </div>




                      </div>





                      <div className="
                        flex
                        gap-2
                        pt-4
                      ">


                        <Link

                          href={`/dashboard/insurance/${claim.id}`}

                          className="
                            btn-secondary
                            flex
                            items-center
                            gap-2
                          "

                        >

                          <Eye size={15}/>

                          View

                        </Link>





                        <Link

                          href={`/dashboard/insurance/${claim.id}/edit`}

                          className="
                            btn-primary
                            flex
                            items-center
                            gap-2
                          "

                        >

                          <Pencil size={15}/>

                          Edit

                        </Link>



                      </div>




                    </div>





                  </div>

                )

              )

            }


          </div>

        )

      }


    </div>

  );

}