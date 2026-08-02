"use client";


import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

import {
  doc,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";


import { db } from "@/lib/firebase";


import {
  PageHeader,
  Field,
  useToast,
} from "@/components/ui";


import {
  Customer,
  Vehicle,
  JobCard,
} from "@/lib/models";


import {
  toMinor,
} from "@/lib/format";


import {
  ShieldCheck,
} from "lucide-react";




export default function CreateInsurancePage() {


  const router = useRouter();

  const params = useSearchParams();

  const jobId = params.get("jobId");


  const { notify } = useToast();



  const [job,setJob] =
    useState<JobCard | null>(null);


  const [customer,setCustomer] =
    useState<Customer | null>(null);


  const [vehicle,setVehicle] =
    useState<Vehicle | null>(null);



  const [loading,setLoading] =
    useState(true);





  useEffect(()=>{


    async function load(){


      if(!jobId){

        setLoading(false);

        return;

      }



      const jsnap =
        await getDoc(
          doc(db,"jobCards",jobId)
        );



      if(!jsnap.exists()){

        setLoading(false);

        return;

      }



      const j = {

        id:jsnap.id,

        ...jsnap.data(),

      } as unknown as JobCard;



      setJob(j);





      const csnap =
        await getDoc(
          doc(
            db,
            "customers",
            j.customerId
          )
        );



      if(csnap.exists()){

        setCustomer({

          id:csnap.id,

          ...csnap.data(),

        } as unknown as Customer);

      }







      const vsnap =
        await getDoc(
          doc(
            db,
            "vehicles",
            j.vehicleId
          )
        );



      if(vsnap.exists()){


        setVehicle({

          id:vsnap.id,

          ...vsnap.data(),

        } as unknown as Vehicle);


      }



      setLoading(false);


    }



    load();



  },[jobId]);








  async function save(form:FormData){


    if(!job){

      notify(
        "Job card not found",
        "error"
      );

      return;

    }





    try{


      await addDoc(

        collection(
          db,
          "insuranceClaims"
        ),

        {


          branchId:
            job.branchId,



          jobCardId:
            job.id,



          customerId:
            job.customerId,



          vehicleId:
            job.vehicleId,



          companyName:
            String(
              form.get("companyName") || ""
            ),



          policyNumber:
            String(
              form.get("policyNumber") || ""
            ),



          claimNumber:
            String(
              form.get("claimNumber") || ""
            ),





          claimAmountMinor:
            toMinor(
              String(
                form.get("claimAmount") || "0"
              )
            ),



          receivedAmountMinor:
            toMinor(
              String(
                form.get("receivedAmount") || "0"
              )
            ),





          status:
            String(
              form.get("status")
            ),





          notes:
            String(
              form.get("notes") || ""
            ),





          createdAt:
            serverTimestamp(),


        }

      );



      notify(
        "Insurance claim added"
      );



      router.push(
        "/dashboard/insurance"
      );


    }

    catch{


      notify(
        "Could not save insurance",
        "error"
      );


    }


  }






  if(loading || !job)

    return (

      <p className="p-6">
        Loading insurance form...
      </p>

    );







  return (


    <div className="mx-auto max-w-3xl">


      <PageHeader

        eyebrow="Finance"

        title="Add Insurance Claim"

        icon={ShieldCheck}

      />





      <div className="card p-6 space-y-5">





        <div className="rounded-xl bg-surface-muted p-4 space-y-2">


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

            {vehicle
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

            {job.complaint}

          </p>




          <p>

            <strong>
              Final Bill:
            </strong>

            {" "}

            {(
              (job.totalMinor ?? 0)
              /
              100
            ).toFixed(2)}

            {" "}
            LKR

          </p>



        </div>








        <form

          action={save}

          className="space-y-4"

        >





          <Field
            label="Insurance Company"
            required
          >

            <input

              name="companyName"

              className="input-luxe"

              required

            />

          </Field>






          <Field label="Policy Number">

            <input

              name="policyNumber"

              className="input-luxe"

            />

          </Field>






          <Field label="Claim Number">

            <input

              name="claimNumber"

              className="input-luxe"

            />

          </Field>







          <Field label="Claim Amount (LKR)">

            <input

              name="claimAmount"

              className="input-luxe"

              inputMode="decimal"

            />

          </Field>







          <Field label="Received Amount (LKR)">

            <input

              name="receivedAmount"

              className="input-luxe"

              inputMode="decimal"

            />

          </Field>







          <Field label="Status">


            <select

              name="status"

              className="input-luxe"

              defaultValue="pending"

            >

              <option value="pending">
                Pending
              </option>


              <option value="approved">
                Approved
              </option>



              <option value="received">
                Received
              </option>



              <option value="rejected">
                Rejected
              </option>


            </select>


          </Field>








          <Field label="Notes">


            <textarea

              name="notes"

              className="input-luxe"

              rows={4}

            />


          </Field>








          <button

            type="submit"

            className="btn-primary"

          >

            Save Insurance Claim

          </button>






        </form>






      </div>



    </div>


  );


}