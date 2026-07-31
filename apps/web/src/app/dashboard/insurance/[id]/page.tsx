"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import {
  doc,
  getDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

import {
  InsuranceClaim,
  Customer,
  Vehicle,
  JobCard,
} from "@/lib/models";

import {
  PageHeader,
  Badge,
} from "@/components/ui";

import {
  formatMoney,
  formatDate,
} from "@/lib/format";

import {
  ShieldCheck,
  Pencil,
} from "lucide-react";


export default function InsuranceDetailsPage() {


  const params = useParams();

  const router = useRouter();

  const id = params.id as string;



  const [claim,setClaim] =
    useState<InsuranceClaim | null>(null);


  const [customer,setCustomer] =
    useState<Customer | null>(null);


  const [vehicle,setVehicle] =
    useState<Vehicle | null>(null);


  const [job,setJob] =
    useState<JobCard | null>(null);


  const [loading,setLoading] =
    useState(true);





  useEffect(()=>{


    async function load(){


      try{


        const claimSnap =
          await getDoc(
            doc(
              db,
              "insuranceClaims",
              id
            )
          );



        if(!claimSnap.exists()){


          router.push(
            "/dashboard/insurance"
          );

          return;

        }



        const claimData =
        {
          id: claimSnap.id,
          ...claimSnap.data(),
        } as unknown as InsuranceClaim;



        setClaim(claimData);





        // CUSTOMER

        const customerSnap =
          await getDoc(
            doc(
              db,
              "customers",
              claimData.customerId
            )
          );



        if(customerSnap.exists()){


          setCustomer({

            id: customerSnap.id,

            ...customerSnap.data(),

          } as unknown as Customer);


        }







        // VEHICLE

        const vehicleSnap =
          await getDoc(
            doc(
              db,
              "vehicles",
              claimData.vehicleId
            )
          );



        if(vehicleSnap.exists()){


          setVehicle({

            id: vehicleSnap.id,

            ...vehicleSnap.data(),

          } as unknown as Vehicle);


        }








        // JOB CARD

        const jobSnap =
          await getDoc(
            doc(
              db,
              "jobCards",
              claimData.jobCardId
            )
          );



        if(jobSnap.exists()){


          setJob({

            id: jobSnap.id,

            ...jobSnap.data(),

          } as unknown as JobCard);


        }



      }

      catch(error){

        console.error(
          "LOAD INSURANCE DETAILS ERROR",
          error
        );

      }

      finally{

        setLoading(false);

      }


    }



    load();



  },[id,router]);









  if(
    loading ||
    !claim
  ){

    return (

      <p className="p-6">
        Loading insurance details...
      </p>

    );

  }









  return (

    <div className="mx-auto max-w-3xl">


      <PageHeader

        eyebrow="Finance"

        title="Insurance Claim Details"

        icon={ShieldCheck}


        action={

          <Link

            href={`/dashboard/insurance/${id}/edit`}

            className="
              btn-primary
              flex
              gap-2
              items-center
            "

          >

            <Pencil size={15}/>

            Edit

          </Link>

        }

      />








      <div className="card p-6 space-y-6">






        <div className="flex justify-between items-center">


          <h2 className="
            text-xl
            font-semibold
            text-ink
          ">

            {claim.companyName}

          </h2>



          <Badge tone="amber">

            {claim.status.toUpperCase()}

          </Badge>



        </div>








        <div className="
          rounded-xl
          bg-surface-muted
          p-4
          space-y-3
        ">


          <p>

            <strong>
              Customer:
            </strong>

            {" "}

            {customer?.displayName ?? "-"}

          </p>





          <p>

            <strong>
              Vehicle:
            </strong>

            {" "}

            {
              vehicle
              ?
              `${vehicle.make} ${vehicle.model} · ${vehicle.plateNumber}`
              :
              "-"
            }

          </p>





          <p>

            <strong>
              Job:
            </strong>

            {" "}

            {job?.complaint ?? "-"}

          </p>



        </div>









        <div className="space-y-3">


          <p>

            <strong>
              Policy Number:
            </strong>

            {" "}

            {claim.policyNumber || "-"}

          </p>





          <p>

            <strong>
              Claim Number:
            </strong>

            {" "}

            {claim.claimNumber || "-"}

          </p>





          <p>

            <strong>
              Claim Amount:
            </strong>

            {" "}

            {formatMoney(
              claim.claimAmountMinor
            )}

          </p>





          <p>

            <strong>
              Received Amount:
            </strong>

            {" "}

            {formatMoney(
              claim.receivedAmountMinor
            )}

          </p>






          <p>

            <strong>
              Created:
            </strong>

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






          <p>

            <strong>
              Notes:
            </strong>

            {" "}

            {claim.notes || "-"}

          </p>



        </div>





      </div>





    </div>

  );

}